/**
 * BridgeClient — single WebSocket to gatesai-bridge with id-correlation.
 *
 * Design:
 *
 *  - One persistent WebSocket. Caller code never sees the socket; it
 *    just calls `client.request(op, data, onEvent?)` and gets a Promise
 *    that resolves with the bridge's `result` payload.
 *  - Each request gets a fresh id. We keep a Map<id, pending> so we can
 *    route incoming `event` / `result` / `error` envelopes to the right
 *    Promise and (optionally) the right event callback.
 *  - If the socket isn't open, `request` throws synchronously with a
 *    BridgeOfflineError. Higher layers turn this into a tool-result
 *    "Error: bridge offline. Start gatesai-bridge." string.
 *  - Auto-reconnect is handled at the BridgeStore layer (which polls
 *    /health), not here. This class stays single-purpose.
 */

import { isRecord } from '../../core/guards';
const REQUEST_ID_VERSION = '1';
export const BRIDGE_PROTOCOL_VERSION = 2;
export const LEGACY_BRIDGE_PROTOCOL_VERSION = 0;
const DEFAULT_HANDSHAKE_GRACE_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface Envelope {
  id: string;
  type: 'request' | 'event' | 'result' | 'error';
  op?: string;
  data?: unknown;
  /**
   * Marks requests issued by the app's own chat-persistence layer. The
   * bridge denies access to the protected chat-history subtrees
   * (`.gatesai/chat/`, `chat-history/`) unless this is set. Never set it
   * on behalf of model tool calls.
   */
  privileged?: boolean;
}

export interface BridgeRequestOptions {
  /** See {@link Envelope.privileged}. Persistence-layer use only. */
  privileged?: boolean;
  /**
   * Envelope timeout for the bridge response. `undefined` uses the default,
   * `null` disables the client-side envelope timeout for long streaming ops.
   */
  timeoutMs?: number | null;
  /** Reset the envelope timeout whenever an `event` frame arrives. */
  resetTimeoutOnEvent?: boolean;
}

interface ErrorPayload {
  message: string;
  code?: string;
}

type EventHandler = (data: unknown) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onEvent?: EventHandler;
  resetTimer?: () => void;
  clearTimer: () => void;
  resetTimeoutOnEvent: boolean;
}

export class BridgeOfflineError extends Error {
  constructor(message = 'Bridge offline. Start gatesai-bridge.') {
    super(message);
    this.name = 'BridgeOfflineError';
  }
}

export class BridgeError extends Error {
  readonly op: string | undefined;
  readonly code: string | undefined;
  constructor(message: string, op?: string, code?: string) {
    super(message);
    this.name = 'BridgeError';
    this.op = op;
    this.code = code;
  }
}

export class BridgeClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private connectingPromise: Promise<void> | null = null;
  private handshakeWaiter: ((protocolVersion: number) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Open the WebSocket. Idempotent — if already open or connecting,
   * returns the in-flight connect promise. Resolves once `onopen` fires;
   * rejects if the socket fails to open within a short window.
   */
  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.socket = ws;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          this.socket = null;
          reject(new BridgeOfflineError(`Bridge connect timed out (${this.url})`));
        }
      }, 3000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = null;
        reject(new BridgeOfflineError());
      };

      ws.onclose = () => {
        // Drop and reject any in-flight requests so callers don't hang.
        for (const [, p] of this.pending) {
          p.reject(new BridgeOfflineError('Bridge connection closed mid-request.'));
        }
        this.pending.clear();
        this.handshakeWaiter?.(LEGACY_BRIDGE_PROTOCOL_VERSION);
        this.handshakeWaiter = null;
        this.socket = null;
      };

      ws.onmessage = (ev) => {
        this.handleMessage(ev.data);
      };
    });

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Negotiate the app/bridge wire protocol after the socket opens. Bridges
   * predating the hello frame simply stay silent; after a short grace period
   * they are reported as protocol v0 so the store can show upgrade guidance.
   */
  negotiateProtocol(graceMs = DEFAULT_HANDSHAKE_GRACE_MS): Promise<number> {
    if (!this.isOpen()) return Promise.reject(new BridgeOfflineError());

    return new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (protocolVersion: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.handshakeWaiter === finish) this.handshakeWaiter = null;
        resolve(protocolVersion);
      };
      const timer = setTimeout(() => finish(LEGACY_BRIDGE_PROTOCOL_VERSION), graceMs);
      this.handshakeWaiter = finish;
      try {
        this.socket!.send(JSON.stringify({ type: 'hello', protocolVersion: BRIDGE_PROTOCOL_VERSION }));
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        this.handshakeWaiter = null;
        reject(new BridgeOfflineError(`Handshake send failed: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Send a request and wait for `result`. Optional `onEvent` is called
   * for every `event` envelope tagged with this request's id (used by
   * exec.run for streamed stdout/stderr lines).
   */
  async request<T = unknown>(
    op: string,
    data: unknown,
    onEvent?: EventHandler,
    options?: BridgeRequestOptions,
  ): Promise<T> {
    if (!this.isOpen()) {
      throw new BridgeOfflineError();
    }
    const id = `j-${REQUEST_ID_VERSION}-${this.nextId++}`;
    const envelope: Envelope = {
      id,
      type: 'request',
      op,
      data,
      ...(options?.privileged ? { privileged: true } : {}),
    };
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs === null ? null : options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const resetTimer = timeoutMs === null
        ? undefined
        : () => {
          clearTimer();
          timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new BridgeError(`Bridge request timed out after ${Math.round(timeoutMs / 1000)}s`, op, 'bridge_timeout'));
          }, timeoutMs);
        };
      resetTimer?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimer();
          resolve(v as T);
        },
        reject: (err) => {
          clearTimer();
          reject(err);
        },
        onEvent,
        resetTimer,
        clearTimer,
        resetTimeoutOnEvent: Boolean(options?.resetTimeoutOnEvent),
      });
      try {
        this.socket!.send(JSON.stringify(envelope));
      } catch (err) {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.reject(new BridgeOfflineError(`Send failed: ${(err as Error).message}`));
      }
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return;
    }
    if (isRecord(decoded) && decoded.type === 'hello' && Number.isInteger(decoded.protocolVersion)) {
      this.handshakeWaiter?.(decoded.protocolVersion as number);
      return;
    }
    let env: Envelope;
    try {
      const parsed = parseEnvelope(decoded);
      if (!parsed.ok) return;
      env = parsed.value;
    } catch {
      return;
    }
    if (!env.id) return;
    const pending = this.pending.get(env.id);
    if (!pending) return;
    if (!env.type) {
      this.pending.delete(env.id);
      pending.reject(new BridgeError('Malformed bridge frame: missing type', env.op, 'bridge_protocol_error'));
      return;
    }

    switch (env.type) {
      case 'event':
        if (pending.resetTimeoutOnEvent) pending.resetTimer?.();
        pending.onEvent?.(env.data);
        return;
      case 'result':
        this.pending.delete(env.id);
        pending.resolve(env.data);
        return;
      case 'error': {
        this.pending.delete(env.id);
        const payload = parseErrorPayload(env.data);
        pending.reject(new BridgeError(payload?.message ?? 'Bridge error', env.op, payload?.code));
        return;
      }
      default:
        return;
    }
  }
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false };

function parseEnvelope(value: unknown): ParseResult<Envelope> {
  if (!isRecord(value)) return { ok: false };
  const id = typeof value.id === 'string' ? value.id : '';
  const type = value.type;
  if (!id || (type !== 'request' && type !== 'event' && type !== 'result' && type !== 'error')) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      id,
      type,
      op: typeof value.op === 'string' ? value.op : undefined,
      data: value.data,
    },
  };
}

function parseErrorPayload(value: unknown): ErrorPayload | undefined {
  if (!isRecord(value) || typeof value.message !== 'string') return undefined;
  return {
    message: value.message,
    code: typeof value.code === 'string' ? value.code : undefined,
  };
}


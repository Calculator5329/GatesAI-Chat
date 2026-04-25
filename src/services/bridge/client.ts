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

const PROTOCOL_VERSION = '1';

interface Envelope {
  id: string;
  type: 'request' | 'event' | 'result' | 'error';
  op?: string;
  data?: unknown;
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
   * Send a request and wait for `result`. Optional `onEvent` is called
   * for every `event` envelope tagged with this request's id (used by
   * exec.run for streamed stdout/stderr lines).
   */
  async request<T = unknown>(
    op: string,
    data: unknown,
    onEvent?: EventHandler,
  ): Promise<T> {
    if (!this.isOpen()) {
      throw new BridgeOfflineError();
    }
    const id = `j-${PROTOCOL_VERSION}-${this.nextId++}`;
    const envelope: Envelope = { id, type: 'request', op, data };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        onEvent,
      });
      try {
        this.socket!.send(JSON.stringify(envelope));
      } catch (err) {
        this.pending.delete(id);
        reject(new BridgeOfflineError(`Send failed: ${(err as Error).message}`));
      }
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (!env.id || !env.type) return;
    const pending = this.pending.get(env.id);
    if (!pending) return;

    switch (env.type) {
      case 'event':
        pending.onEvent?.(env.data);
        return;
      case 'result':
        this.pending.delete(env.id);
        pending.resolve(env.data);
        return;
      case 'error': {
        this.pending.delete(env.id);
        const payload = env.data as ErrorPayload | undefined;
        pending.reject(new BridgeError(payload?.message ?? 'Bridge error', env.op, payload?.code));
        return;
      }
      default:
        return;
    }
  }
}

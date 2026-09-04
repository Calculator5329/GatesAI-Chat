// gatesai-bridge mocks: the /health poll and a fake WebSocket that speaks the
// request/result envelope BridgeClient expects (hello v2 handshake, then
// `{id,type:'request',op,data}` answered by `{id,type:'result',op,data}`).
// Mirrors tests/e2e/fixtures/harness.ts so both harnesses agree on shapes.
import type { BridgeFile, BridgePlan, MockRoute } from '../types';
import { jsonResponse, hostMatches, networkFailure } from './http';

export const BRIDGE_HOST = '127.0.0.1:7331';
export const BRIDGE_WS_URL = 'ws://127.0.0.1:7331/ws';

// A 64x64 PNG (green field, pale disc). The OpenRouter image client accepts
// only png, jpeg, webp or gif data URLs, so generated images use this one.
export const VISIBLE_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAjUlEQVR42u3YsQ2AMAwEQA/CQEzD7DTp2QCEEuTEnOQB/jr/x3bsS18AAAAAAAAAAAAAAAAAlAG0dt7fvIDH6F8wIiX9QENkpR9liMT0QwyRm77fEOnpOw0/BgxM32MAAAAAAAAAWBPgmZsAsHwfqNDIKnTiCqtEhV2owjJn3AUAAAAAAAAAAAAAAHhzFwCc9gheFXbKAAAAAElFTkSuQmCC';

// A visibly rendered SVG for image reads, so gallery and lightbox captures do
// not come back as black squares.
export const VISIBLE_IMAGE_SVG_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBzdG9wLWNvbG9yPSIjMjdkMTdmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNDg2Y2ZmIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSJ1cmwoI2cpIi8+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMTQiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjg1Ii8+PC9zdmc+';

export function bridgeRoutes(plan: BridgePlan | 'offline' | undefined): MockRoute[] {
  if (!plan) return [];
  if (plan === 'offline') {
    return [{ name: 'bridge.offline', matches: req => hostMatches(req, BRIDGE_HOST), respond: req => networkFailure(req.url) }];
  }
  return [{
    name: 'bridge.health',
    matches: req => hostMatches(req, BRIDGE_HOST) && req.url.pathname === '/health',
    respond: () => jsonResponse({
      status: 'ok',
      version: 'scenario-bridge-1.0.0',
      workspace_root: plan.workspaceRoot ?? 'C:/gatesai-workspace',
      platform: 'win32',
      allowlist: plan.allowlist ?? ['python', 'git', 'node', 'sqlite3'],
    }),
  }];
}

/** In-memory file table so writes made during a journey are readable afterwards. */
export class BridgeFileTable {
  private readonly files = new Map<string, BridgeFile>();

  constructor(seed: BridgeFile[]) {
    for (const file of seed) this.files.set(file.path, { ...file });
  }

  list(): BridgeFile[] {
    return [...this.files.values()];
  }

  get(path: string): BridgeFile | undefined {
    return this.files.get(path);
  }

  write(path: string, content: string, encoding?: string): BridgeFile {
    const name = path.split('/').pop() ?? path;
    const mime = encoding === 'base64' ? 'image/png' : guessMime(name);
    const file: BridgeFile = { path, name, kind: 'file', content, mime, size: content.length };
    this.files.set(path, file);
    this.ensureParents(path);
    return file;
  }

  remove(path: string): void {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }

  private ensureParents(path: string): void {
    const parts = path.split('/').filter(Boolean);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const dir = `/${parts.slice(0, depth).join('/')}`;
      if (!this.files.has(dir)) this.files.set(dir, { path: dir, name: parts[depth - 1], kind: 'dir' });
    }
  }
}

function guessMime(name: string): string {
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain';
}

/** Marker the socket turns into an error envelope; keeps handleBridgeOp a plain function. */
export interface BridgeOpError { __bridgeError: { message: string; code: string } }

export function bridgeError(message: string, code: string): BridgeOpError {
  return { __bridgeError: { message, code } };
}

export function isBridgeOpError(value: unknown): value is BridgeOpError {
  return typeof value === 'object' && value !== null && '__bridgeError' in value;
}

export function handleBridgeOp(op: string | undefined, data: Record<string, unknown>, table: BridgeFileTable): unknown {
  const path = typeof data.path === 'string' ? data.path : '';
  switch (op) {
    case 'fs.write': {
      const content = typeof data.content === 'string' ? data.content : '';
      const file = table.write(path, content, typeof data.encoding === 'string' ? data.encoding : undefined);
      return { path, bytes: file.content?.length ?? 0 };
    }
    case 'fs.read': {
      const file = table.get(path);
      const base64 = data.encoding === 'base64';
      if (file?.kind === 'file' && file.content !== undefined) {
        return { path, content: file.content, encoding: base64 ? 'base64' : 'utf8', size: file.content.length, mime: file.mime ?? 'text/plain' };
      }
      if (!base64) return bridgeError(`No such file: ${path}`, 'fs_not_found');
      if (path.includes('broken')) return bridgeError(`Unreadable media: ${path}`, 'fs_read_failed');
      return { path, content: VISIBLE_IMAGE_SVG_BASE64, encoding: 'base64', size: 345, mime: 'image/svg+xml' };
    }
    case 'fs.stat': {
      const file = table.get(path);
      if (!file) return { path, kind: 'file', size: 1, mtime: Date.now(), mime: 'text/plain' };
      return { path, kind: file.kind, size: file.size ?? file.content?.length ?? 1, mtime: Date.now(), mime: file.mime ?? (file.kind === 'file' ? 'text/plain' : undefined) };
    }
    case 'fs.list': {
      const prefix = path === '/workspace' || path === '' ? '/workspace/' : `${path}/`;
      return {
        path,
        entries: table.list()
          .filter(entry => entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes('/'))
          .map(entry => ({
            path: entry.path,
            name: entry.name,
            kind: entry.kind,
            size: entry.size ?? entry.content?.length ?? 1,
            mtime: Date.now(),
            mime: entry.mime ?? (entry.kind === 'file' ? 'text/plain' : undefined),
          })),
      };
    }
    case 'fs.delete':
      table.remove(path);
      return {};
    case 'exec.run': {
      const cmd = typeof data.cmd === 'string' ? data.cmd : 'command';
      return { exit_code: 0, duration_ms: 12, stdout: `${cmd}: ok (mocked by the dev scenario)\n`, stderr: '' };
    }
    default:
      return {};
  }
}

interface BridgeEnvelope {
  id?: string;
  type?: string;
  op?: string;
  data?: Record<string, unknown>;
}

/**
 * A WebSocket stand-in for the bridge. Opens on the next tick, answers the
 * hello handshake with protocol v2 and every request with a result envelope.
 * When `online` is false it errors and closes instead, which BridgeClient
 * reports as BridgeOfflineError.
 */
export class ScenarioBridgeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = ScenarioBridgeSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent | Event) => void) | null = null;
  readonly url: string;
  readonly sent: string[] = [];
  private readonly table: BridgeFileTable;
  private readonly online: boolean;

  constructor(url: string, table: BridgeFileTable, online: boolean) {
    super();
    this.url = url;
    this.table = table;
    this.online = online;
    setTimeout(() => (this.online ? this.open() : this.fail()), 0);
  }

  send(payload: string): void {
    if (this.readyState !== ScenarioBridgeSocket.OPEN) throw new Error('ScenarioBridgeSocket is not open');
    this.sent.push(payload);
    let env: BridgeEnvelope;
    try {
      env = JSON.parse(payload) as BridgeEnvelope;
    } catch {
      return;
    }
    if (env.type === 'hello') {
      this.deliver({ type: 'hello', protocolVersion: 2 });
      return;
    }
    if (env.type !== 'request' || !env.id) return;
    const data = handleBridgeOp(env.op, env.data ?? {}, this.table);
    if (isBridgeOpError(data)) {
      this.deliver({ id: env.id, type: 'error', op: env.op, data: data.__bridgeError });
      return;
    }
    this.deliver({ id: env.id, type: 'result', op: env.op, data });
  }

  close(): void {
    if (this.readyState === ScenarioBridgeSocket.CLOSED) return;
    this.readyState = ScenarioBridgeSocket.CLOSED;
    const ev = new Event('close');
    this.onclose?.(ev);
    this.dispatchEvent(ev);
  }

  private open(): void {
    this.readyState = ScenarioBridgeSocket.OPEN;
    const ev = new Event('open');
    this.onopen?.(ev);
    this.dispatchEvent(ev);
  }

  private fail(): void {
    const ev = new Event('error');
    this.onerror?.(ev);
    this.dispatchEvent(ev);
    this.close();
  }

  private deliver(message: unknown): void {
    setTimeout(() => {
      if (this.readyState !== ScenarioBridgeSocket.OPEN) return;
      const ev = new MessageEvent('message', { data: JSON.stringify(message) });
      this.onmessage?.(ev);
      this.dispatchEvent(ev);
    }, 0);
  }
}

/**
 * Replace window.WebSocket with a constructor that hands bridge URLs to the
 * scenario socket and everything else (Vite HMR, ComfyUI progress) to the
 * real implementation.
 */
export function createWebSocketPatch(real: typeof WebSocket, table: BridgeFileTable, online: boolean): typeof WebSocket {
  const sockets: ScenarioBridgeSocket[] = [];
  const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = typeof url === 'string' ? url : url.toString();
    if (href === BRIDGE_WS_URL) {
      const socket = new ScenarioBridgeSocket(href, table, online);
      sockets.push(socket);
      return socket;
    }
    return new real(url, protocols);
  } as unknown as typeof WebSocket & { sockets: ScenarioBridgeSocket[] };
  Object.defineProperties(Patched, {
    CONNECTING: { value: 0 },
    OPEN: { value: 1 },
    CLOSING: { value: 2 },
    CLOSED: { value: 3 },
    prototype: { value: real.prototype },
    sockets: { value: sockets },
  });
  return Patched;
}

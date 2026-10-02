import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComfyProgress } from '../../../../src/services/image/jobs/comfyProgress';
import { recentLogs } from '../../../../src/services/diagnostics/logger';
import { localFetch } from '../../../../src/services/local/localHttp';

vi.mock('../../../../src/services/local/localHttp', () => ({
  localFetch: vi.fn(async () => new Response(null, { status: 200 })),
}));

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: { wasClean: boolean; code: number }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ wasClean: true, code: 1000 });
  }

  /** What a ComfyUI started without --enable-cors-header does to the webview's handshake. */
  refuse(): void {
    this.onerror?.(new Event('error'));
    this.onclose?.({ wasClean: false, code: 1006 });
  }
}

const originalWS = globalThis.WebSocket;

beforeEach(() => {
  FakeWS.instances = [];
  vi.mocked(localFetch).mockClear();
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.WebSocket = originalWS;
});

describe('createComfyProgress', () => {
  it('creates a WebSocket pointing at the configured baseUrl', () => {
    const p = createComfyProgress({ baseUrl: 'http://127.0.0.1:8188', clientId: 'abc', fetch: vi.fn() as unknown as typeof fetch });
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('ws://127.0.0.1:8188/ws?clientId=abc');
    p.dispose();
  });

  it('forwards progress frames to subscribers', () => {
    const p = createComfyProgress({ baseUrl: 'http://h:1', clientId: 'c', fetch: vi.fn() as unknown as typeof fetch });
    const events: Array<{ value: number; max: number }> = [];
    p.subscribe(e => events.push(e));
    FakeWS.instances[0].emit({ type: 'progress', data: { value: 5, max: 20 } });
    expect(events).toEqual([{ value: 5, max: 20 }]);
    p.dispose();
  });

  it('ignores non-progress frames', () => {
    const p = createComfyProgress({ baseUrl: 'http://h:1', clientId: 'c', fetch: vi.fn() as unknown as typeof fetch });
    const events: Array<{ value: number; max: number }> = [];
    p.subscribe(e => events.push(e));
    FakeWS.instances[0].emit({ type: 'status', data: { status: 'ok' } });
    FakeWS.instances[0].emit({ type: 'executed', data: { node: '9' } });
    expect(events).toEqual([]);
    p.dispose();
  });

  it('cancel() POSTs to /interrupt', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const p = createComfyProgress({ baseUrl: 'http://h:1/', clientId: 'c', fetch: fetchImpl });
    await p.cancel();
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('http://h:1/interrupt');
    expect((calls[0][1] as RequestInit).method).toBe('POST');
    p.dispose();
  });

  it('cancel() sends /interrupt through localFetch by default, not the webview fetch', async () => {
    const webviewFetch = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', webviewFetch);
    const p = createComfyProgress({ baseUrl: 'http://127.0.0.1:8188', clientId: 'c' });

    await p.cancel();

    expect(localFetch).toHaveBeenCalledWith('http://127.0.0.1:8188/interrupt', { method: 'POST' });
    expect(webviewFetch).not.toHaveBeenCalled();
    p.dispose();
  });

  it('a refused progress socket stays quiet and cancel still reaches ComfyUI', async () => {
    const warningsBefore = recentLogs({ level: 'warn', scope: 'comfy-progress' }).length;
    const p = createComfyProgress({ baseUrl: 'http://127.0.0.1:8188', clientId: 'c' });
    const events: Array<{ value: number; max: number }> = [];
    p.subscribe(e => events.push(e));

    expect(() => FakeWS.instances[0].refuse()).not.toThrow();
    await p.cancel();

    expect(recentLogs({ level: 'warn', scope: 'comfy-progress' })).toHaveLength(warningsBefore);
    expect(recentLogs({ scope: 'comfy-progress', limit: 2 }).map(e => e.message).join('\n')).toMatch(/--enable-cors-header/);
    expect(events).toEqual([]);
    expect(localFetch).toHaveBeenCalledWith('http://127.0.0.1:8188/interrupt', { method: 'POST' });
    p.dispose();
  });

  it('dispose() closes the WebSocket', () => {
    const p = createComfyProgress({ baseUrl: 'http://h:1', clientId: 'c', fetch: vi.fn() as unknown as typeof fetch });
    p.dispose();
    expect(FakeWS.instances[0].closed).toBe(true);
  });
});

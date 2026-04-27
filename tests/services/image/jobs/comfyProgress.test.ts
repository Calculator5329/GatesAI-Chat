import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComfyProgress } from '../../../../src/services/image/jobs/comfyProgress';

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
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
    this.onclose?.();
  }
}

const originalWS = globalThis.WebSocket;

beforeEach(() => {
  FakeWS.instances = [];
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

  it('dispose() closes the WebSocket', () => {
    const p = createComfyProgress({ baseUrl: 'http://h:1', clientId: 'c', fetch: vi.fn() as unknown as typeof fetch });
    p.dispose();
    expect(FakeWS.instances[0].closed).toBe(true);
  });
});

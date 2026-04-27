import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createA1111Progress } from '../../../../src/services/image/jobs/a1111Progress';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createA1111Progress', () => {
  it('polls /sdapi/v1/progress and forwards events', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sdapi/v1/progress')) {
        calls++;
        return new Response(JSON.stringify({ progress: 0.25 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const p = createA1111Progress({ baseUrl: 'http://127.0.0.1:7860', intervalMs: 100, fetch: fetchImpl });
    const events: Array<{ value: number; max: number }> = [];
    p.subscribe(e => events.push(e));

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toEqual({ value: 25, max: 100 });
    p.dispose();
  });

  it('cancel() POSTs to /sdapi/v1/interrupt', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const p = createA1111Progress({ baseUrl: 'http://127.0.0.1:7860/', intervalMs: 60_000, fetch: fetchImpl });
    await p.cancel();
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.find(c => String(c[0]).includes('/sdapi/v1/interrupt'))).toBeDefined();
    p.dispose();
  });

  it('cancel() forwards bearer auth when an apiKey is set', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const p = createA1111Progress({ baseUrl: 'http://h:1', intervalMs: 60_000, apiKey: 'shh', fetch: fetchImpl });
    await p.cancel();
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const interruptCall = calls.find(c => String(c[0]).includes('/interrupt'));
    expect(interruptCall).toBeDefined();
    const headers = (interruptCall![1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer shh');
    p.dispose();
  });

  it('dispose() stops polling', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ progress: 0.5 }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const p = createA1111Progress({ baseUrl: 'http://h:1', intervalMs: 50, fetch: fetchImpl });
    p.dispose();
    await vi.advanceTimersByTimeAsync(500);
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.filter(c => String(c[0]).includes('/sdapi/v1/progress')).length).toBe(0);
  });
});

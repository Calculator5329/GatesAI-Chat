import { describe, expect, it } from 'vitest';
import { A1111Client } from '../../../src/services/image/a1111Client';

function makeFakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch: impl as typeof fetch, calls };
}

describe('A1111Client', () => {
  it('POSTs to /sdapi/v1/txt2img with width/height for the aspect and returns base64', async () => {
    const { fetch: fakeFetch, calls } = makeFakeFetch(() =>
      new Response(JSON.stringify({
        images: ['aGVsbG8='],
        info: JSON.stringify({ seed: 1234 }),
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const client = new A1111Client({ baseUrl: 'http://127.0.0.1:7860/', fetch: fakeFetch });
    const out = await client.generate({ prompt: 'a cat', aspectRatio: '16:9', seed: 42 });

    expect(out.base64).toBe('aGVsbG8=');
    expect(out.mime).toBe('image/png');
    expect(out.backend).toBe('local-a1111');
    expect(out.seed).toBe(1234);

    expect(calls[0].url).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.prompt).toBe('a cat');
    expect(body.width).toBe(1344);
    expect(body.height).toBe(768);
    expect(body.seed).toBe(42);
  });

  it('uses explicit pixel dimensions when provided', async () => {
    const { fetch: fakeFetch, calls } = makeFakeFetch(() =>
      new Response(JSON.stringify({
        images: ['aGVsbG8='],
        info: JSON.stringify({ seed: 1234 }),
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const client = new A1111Client({ baseUrl: 'http://127.0.0.1:7860/', fetch: fakeFetch });
    const out = await client.generate({ prompt: 'a cat', aspectRatio: '1:1', width: 1360, height: 768, seed: 42 });

    expect(out.width).toBe(1360);
    expect(out.height).toBe(768);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.width).toBe(1360);
    expect(body.height).toBe(768);
  });

  it('surfaces errors with body text', async () => {
    const { fetch: fakeFetch } = makeFakeFetch(() =>
      new Response('{"detail":"no checkpoint loaded"}', { status: 500, statusText: 'Internal Server Error' }),
    );
    const client = new A1111Client({ baseUrl: 'http://127.0.0.1:7860', fetch: fakeFetch });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/a1111 500.*no checkpoint/);
  });

  it('adds Bearer auth when apiKey is set', async () => {
    const { fetch: fakeFetch, calls } = makeFakeFetch(() =>
      new Response(JSON.stringify({ images: ['AA=='] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new A1111Client({ baseUrl: 'http://h', apiKey: 'hunter2', fetch: fakeFetch });
    await client.generate({ prompt: 'x' });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer hunter2');
  });

  it('throws when the response has no images', async () => {
    const { fetch: fakeFetch } = makeFakeFetch(() =>
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new A1111Client({ baseUrl: 'http://h', fetch: fakeFetch });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/missing images array/);
  });
});

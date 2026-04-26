import { describe, expect, it } from 'vitest';
import { FluxClient } from '../../../src/services/image/fluxClient';

function makeFakeFetch(handlers: Array<{ match: (url: string) => boolean; respond: (url: string, init?: RequestInit) => Response | Promise<Response> }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const handler = handlers.find(h => h.match(url));
    if (!handler) throw new Error(`no handler for ${url}`);
    return handler.respond(url, init);
  };
  return { fetch: impl as typeof fetch, calls };
}

function pngBytes(): Uint8Array {
  // Minimum valid PNG signature + a few bytes — enough to round-trip base64.
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
}

describe('FluxClient', () => {
  it('posts Authorization header and image_size and downloads the image', async () => {
    const bytes = pngBytes();
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      {
        match: (u) => u.includes('fal.run/fal-ai/flux-pro/v2'),
        respond: () => new Response(JSON.stringify({
          images: [{ url: 'https://cdn.fal.ai/result/abc.png', width: 1024, height: 1024 }],
          seed: 42,
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      {
        match: (u) => u === 'https://cdn.fal.ai/result/abc.png',
        respond: () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } }),
      },
    ]);

    const client = new FluxClient({ apiKey: 'fal-key-xyz', fetch: fakeFetch });
    const result = await client.generate({ prompt: 'a robot', aspectRatio: '1:1' });

    expect(result.mime).toBe('image/png');
    expect(result.width).toBe(1024);
    expect(result.seed).toBe(42);
    expect(result.base64.length).toBeGreaterThan(0);

    const first = calls[0];
    const headers = first.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Key fal-key-xyz');
    const body = JSON.parse(first.init!.body as string);
    expect(body.prompt).toBe('a robot');
    expect(body.image_size).toEqual({ width: 1024, height: 1024 });
    expect(body.num_images).toBe(1);
  });

  it('uses the correct endpoint per variant and aspect-ratio dims', async () => {
    const bytes = pngBytes();
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      {
        match: (u) => u.includes('flux/v2/dev'),
        respond: () => new Response(JSON.stringify({ images: [{ url: 'https://cdn/img.png' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      {
        match: (u) => u === 'https://cdn/img.png',
        respond: () => new Response(bytes, { status: 200 }),
      },
    ]);

    const client = new FluxClient({ apiKey: 'k', fetch: fakeFetch });
    await client.generate({ prompt: 'x', variant: 'flux-2-dev', aspectRatio: '16:9' });

    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.image_size).toEqual({ width: 1344, height: 768 });
  });

  it('surfaces fal error bodies in the thrown Error', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      {
        match: () => true,
        respond: () => new Response('{"detail":"bad prompt"}', { status: 400, statusText: 'Bad Request' }),
      },
    ]);
    const client = new FluxClient({ apiKey: 'k', fetch: fakeFetch });
    await expect(client.generate({ prompt: 'nope' })).rejects.toThrow(/400.*bad prompt/);
  });

  it('honors endpointOverride', async () => {
    const bytes = pngBytes();
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      {
        match: (u) => u === 'https://example.com/custom',
        respond: () => new Response(JSON.stringify({ images: [{ url: 'https://cdn/z.png' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      {
        match: (u) => u === 'https://cdn/z.png',
        respond: () => new Response(bytes, { status: 200 }),
      },
    ]);
    const client = new FluxClient({ apiKey: 'k', fetch: fakeFetch });
    const out = await client.generate({ prompt: 'x', endpointOverride: 'https://example.com/custom' });
    expect(out.endpoint).toBe('https://example.com/custom');
    expect(calls[0].url).toBe('https://example.com/custom');
  });
});

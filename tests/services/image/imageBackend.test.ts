import { describe, expect, it } from 'vitest';
import { dispatchImageGenerate } from '../../../src/services/image/imageBackend';

function fakeFetchBuilder(handlers: Array<{ match: (url: string) => boolean; respond: () => Response }>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const h = handlers.find((x) => x.match(url));
    if (!h) throw new Error(`no handler for ${url}`);
    return h.respond();
  }) as typeof fetch;
}

function okPng(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
}

describe('dispatchImageGenerate', () => {
  it('returns a descriptive error when ComfyUI base URL is not configured', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'local-comfy' })).rejects.toThrow(/ComfyUI base URL/i);
  });

  it('returns a descriptive error when A1111 base URL is not configured', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'local-a1111' })).rejects.toThrow(/AUTOMATIC1111 base URL/i);
  });

  it('rethrows the underlying error when local backend fails (no auto fallback)', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.endsWith('/sdapi/v1/txt2img'), respond: () => new Response('oops', { status: 500, statusText: 'Internal Server Error' }) },
    ]);
    await expect(dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'local-a1111', a1111BaseUrl: 'http://127.0.0.1:7860', fetch },
    )).rejects.toThrow(/a1111 500/);
  });

  it('routes to A1111 backend successfully', async () => {
    const fetch = fakeFetchBuilder([
      {
        match: (u) => u.endsWith('/sdapi/v1/txt2img'),
        respond: () => new Response(JSON.stringify({ images: [Buffer.from([1, 2, 3]).toString('base64')], info: '{}' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      { match: (u) => u.endsWith('/sdapi/v1/options'), respond: okPng },
    ]);
    const { result } = await dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'local-a1111', a1111BaseUrl: 'http://127.0.0.1:7860', fetch },
    );
    expect(result.backend).toBe('local-a1111');
  });
});

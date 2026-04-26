import { describe, expect, it, vi } from 'vitest';
import { dispatchImageGenerate } from '../../../src/services/image/imageBackend';

function fakeFetchBuilder(handlers: Array<{ match: (url: string) => boolean; respond: () => Response }>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const h = handlers.find((x) => x.match(url));
    if (!h) throw new Error(`no handler for ${url}`);
    return h.respond();
  }) as typeof fetch;
}

function okFal(): Response {
  return new Response(JSON.stringify({ images: [{ url: 'https://cdn/fal.png' }], seed: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
}
function okPng(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
}

describe('dispatchImageGenerate', () => {
  it('routes to the fal backend when primary=fal and fal key is set', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.startsWith('https://fal.run/'), respond: okFal },
      { match: (u) => u === 'https://cdn/fal.png', respond: okPng },
    ]);
    const { result, fallbackNote } = await dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'fal', falApiKey: 'k', fetch },
    );
    expect(result.backend).toBe('fal');
    expect(fallbackNote).toBeUndefined();
  });

  it('returns a descriptive error when primary backend is unconfigured and no fallback', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'fal' })).rejects.toThrow(/no fal\.ai API key/i);
  });

  it('falls back to fal when local primary fails and fallback is configured', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.endsWith('/sdapi/v1/txt2img'), respond: () => new Response('oops', { status: 500, statusText: 'Internal Server Error' }) },
      { match: (u) => u.startsWith('https://fal.run/'), respond: okFal },
      { match: (u) => u === 'https://cdn/fal.png', respond: okPng },
    ]);
    const { result, fallbackNote } = await dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'local-a1111', a1111BaseUrl: 'http://127.0.0.1:7860', falApiKey: 'k', fallback: 'fal', fetch },
    );
    expect(result.backend).toBe('fal');
    expect(fallbackNote).toMatch(/local-a1111 failed/);
    expect(fallbackNote).toMatch(/fell back to fal/);
  });

  it('does NOT auto-fall-back when primary is a cloud backend', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.startsWith('https://fal.run/'), respond: () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }) },
    ]);
    await expect(dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'fal', falApiKey: 'k', fallback: 'fal', fetch },
    )).rejects.toThrow(/fal 429/);
  });

  it('falls back when local backend can\'t even instantiate (no base URL)', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.startsWith('https://fal.run/'), respond: okFal },
      { match: (u) => u === 'https://cdn/fal.png', respond: okPng },
    ]);
    const { result } = await dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'local-comfy', falApiKey: 'k', fallback: 'fal', fetch },
    );
    expect(result.backend).toBe('fal');
  });

  it('reports both errors when fallback also fails', async () => {
    const fetch = fakeFetchBuilder([
      { match: (u) => u.endsWith('/sdapi/v1/txt2img'), respond: () => new Response('boom', { status: 500, statusText: 'err' }) },
    ]);
    // fallback = fal but no fal key configured → error when resolving fallback.
    await expect(dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'local-a1111', a1111BaseUrl: 'http://h', fallback: 'fal', fetch },
    )).rejects.toThrow(/a1111 500/);
  });

  it('treats identical primary/fallback as no-fallback', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500, statusText: 'err' })) as unknown as typeof fetch;
    await expect(dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'fal', falApiKey: 'k', fallback: 'fal', fetch },
    )).rejects.toThrow(/fal 500/);
  });
});

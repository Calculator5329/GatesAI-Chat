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
  it('returns a descriptive error when OpenRouter API key is not configured', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'openrouter-image' })).rejects.toThrow(/OpenRouter API key/i);
  });

  it('returns a descriptive error when ComfyUI base URL is not configured', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'local-comfy' })).rejects.toThrow(/ComfyUI base URL/i);
  });

  it('routes to OpenRouter GPT-5.4 Image 2', async () => {
    let body: { model?: string; modalities?: string[]; stream?: boolean; image_config?: { aspect_ratio?: string } } | null = null;
    const fakeFetch: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'Done.' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            ],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const { result } = await dispatchImageGenerate(
      { prompt: 'x' },
      { primary: 'openrouter-image', openRouterApiKey: 'sk-or-test', fetch: fakeFetch },
    );

    expect(body).toMatchObject({
      model: 'openai/gpt-5.4-image-2',
      modalities: ['image', 'text'],
      stream: false,
      image_config: { aspect_ratio: '1:1' },
    });
    expect(result.backend).toBe('openrouter-image');
    expect(result.mime).toBe('image/png');
    expect(result.base64).toBe('aGVsbG8=');
  });

  it('routes to ComfyUI local image generation', async () => {
    const fetch = fakeFetchBuilder([
      {
        match: (u) => u.endsWith('/prompt'),
        respond: () => new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      {
        match: (u) => u.endsWith('/history/p1'),
        respond: () => new Response(JSON.stringify({
          p1: {
            outputs: {
              '9': { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      { match: (u) => u.includes('/view?'), respond: okPng },
    ]);
    const { result } = await dispatchImageGenerate(
      { prompt: 'x' },
      {
        primary: 'local-comfy',
        comfyBaseUrl: 'http://127.0.0.1:8188',
        comfyQualityPreset: 'quick',
        fetch,
      },
    );
    expect(result.backend).toBe('local-comfy');
  });
});

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
  it('points at local setup first when neither ComfyUI nor an OpenRouter key is available', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, {
      primary: 'openrouter-image',
      comfyBaseUrl: 'http://127.0.0.1:8188',
      comfyDiscovery: { baseUrl: 'http://127.0.0.1:8188', online: false, checkpoints: [], diffusionModels: [], preset: null },
    })).rejects.toThrow(
      'No backend can make images yet. Start ComfyUI or ComfyUI Desktop with an image model '
      + '(Settings > Models > Local shows what is missing), or add an OpenRouter key under Settings > Models.',
    );
  });

  it('asks for the OpenRouter key when OpenRouter was asked for while ComfyUI is running', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, {
      primary: 'openrouter-image',
      comfyDiscovery: { baseUrl: 'http://127.0.0.1:8188', online: true, checkpoints: [], diffusionModels: [], preset: { kind: 'sdxl-lightning' } },
    })).rejects.toThrow(/OpenRouter API key is required/);
  });

  it('says how ComfyUI gets found when no address is known', async () => {
    await expect(dispatchImageGenerate({ prompt: 'x' }, { primary: 'local-comfy' }))
      .rejects.toThrow(/no ComfyUI address configured\. Start ComfyUI or ComfyUI Desktop on this computer; GatesAI looks for it on ports 8188 and 8000\./);
  });

  it('says which folder to fill when ComfyUI is running without a usable model', async () => {
    const fetch = fakeFetchBuilder([]);

    await expect(dispatchImageGenerate({ prompt: 'x' }, {
      primary: 'local-comfy',
      comfyBaseUrl: 'http://127.0.0.1:8000',
      comfyDiscovery: {
        baseUrl: 'http://127.0.0.1:8000',
        online: true,
        checkpoints: ['stable-audio-open-1.0.safetensors'],
        diffusionModels: [],
        preset: null,
      },
      fetch,
    })).rejects.toThrow(/ComfyUI is running at http:\/\/127\.0\.0\.1:8000 but has no image model.*models\/checkpoints/);
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

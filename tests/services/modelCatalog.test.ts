import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, DEFAULT_OPENROUTER_CATALOG_MODEL_IDS, MODELS } from '../../src/core/models';

describe('curated model catalog', () => {
  it('only exposes OpenRouter chat models and local image models in the curated foundation', () => {
    const providerIds = new Set(MODELS.map(model => model.providerId));

    expect(providerIds).toEqual(new Set(['openrouter', 'local-image']));
  });

  it('includes verified GPT-5.5 OpenRouter entries', () => {
    expect(MODELS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'or-gpt-5.5',
        providerId: 'openrouter',
        providerModelId: 'openai/gpt-5.5',
      }),
      expect.objectContaining({
        id: 'or-gpt-5.5-pro',
        providerId: 'openrouter',
        providerModelId: 'openai/gpt-5.5-pro',
      }),
    ]));
  });

  it('exposes a complete default OpenRouter catalog in curated order', () => {
    const byId = new Map(MODELS.map(model => [model.id, model]));

    expect(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.every(id => byId.has(id))).toBe(true);
    expect(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.map(id => byId.get(id)?.providerId))
      .toEqual(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.map(() => 'openrouter'));
    expect(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.map(id => byId.get(id)?.providerModelId))
      .toEqual(expect.arrayContaining([
        'openai/gpt-5.5',
        'openai/gpt-5.5-pro',
        '~openai/gpt-mini-latest',
        '~anthropic/claude-opus-latest',
        '~anthropic/claude-sonnet-latest',
        '~anthropic/claude-haiku-latest',
        'anthropic/claude-opus-4.8',
        'anthropic/claude-opus-4.7',
        '~anthropic/claude-sonnet-latest',
        '~anthropic/claude-haiku-latest',
        '~google/gemini-pro-latest',
        'google/gemini-3.1-pro-preview',
        '~google/gemini-flash-latest',
        'x-ai/grok-4.20',
        'meta-llama/llama-4-maverick',
        'nvidia/nemotron-3-ultra-550b-a55b',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3-super-120b-a12b',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-nano-30b-a3b:free',
        'deepseek/deepseek-v4-pro',
        'moonshotai/kimi-k2.6',
      ]));
  });

  it('includes the full NVIDIA Nemotron 3 family, with Content Safety outside the default chat matrix', () => {
    const byId = new Map(MODELS.map(model => [model.id, model]));

    expect(byId.get('or-nemotron-3-ultra')?.providerModelId).toBe('nvidia/nemotron-3-ultra-550b-a55b');
    expect(byId.get('or-nemotron-3-ultra-free')?.pricing).toEqual({ prompt: 0, completion: 0 });
    expect(byId.get('or-nemotron-3-super')?.providerModelId).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(byId.get('or-nemotron-3-super-free')?.pricing).toEqual({ prompt: 0, completion: 0 });
    expect(byId.get('or-nemotron-3-nano-free')?.contextLength).toBe(256_000);
    expect(byId.get('or-nemotron-3.5-content-safety')).toEqual(expect.objectContaining({
      providerModelId: 'nvidia/nemotron-3.5-content-safety:free',
      supportsTools: false,
    }));
    expect(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS).not.toContain('or-nemotron-3.5-content-safety');
  });

  it('defaults normal chat to the free Nemotron 3 Ultra route via OpenRouter', () => {
    expect(DEFAULT_MODEL_ID).toBe('or-nemotron-3-ultra-free');
  });

  it('does not invent GPT-5.5 mini or nano variants', () => {
    const ids = MODELS.map(model => model.id);

    expect(ids).not.toContain('gpt-5.5-mini');
    expect(ids).not.toContain('gpt-5.5-nano');
    expect(ids).not.toContain('or-gpt-5.5-mini');
    expect(ids).not.toContain('or-gpt-5.5-nano');
  });

  it('includes the offline direct-image mode models', () => {
    expect(MODELS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'image-direct-comfy',
        providerId: 'local-image',
        providerModelId: 'comfy-direct',
        supportsTools: false,
      }),
      expect.objectContaining({
        id: 'image-direct-comfy-draft',
        providerId: 'local-image',
        providerModelId: 'comfy-direct-draft',
        supportsTools: false,
      }),
      expect.objectContaining({
        id: 'image-direct-comfy-upscale',
        providerId: 'local-image',
        providerModelId: 'comfy-direct-upscale',
        supportsTools: false,
      }),
    ]));
  });
});

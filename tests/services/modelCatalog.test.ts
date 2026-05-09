import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, MODELS } from '../../src/core/models';

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

  it('defaults normal chat to Gemini 3 Flash via OpenRouter', () => {
    expect(DEFAULT_MODEL_ID).toBe('or-gemini-3-flash');
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

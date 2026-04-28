import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/core/models';

describe('curated model catalog', () => {
  it('includes verified GPT-5.5 OpenAI and OpenRouter entries', () => {
    expect(MODELS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gpt-5.5',
        providerId: 'openai',
        providerModelId: 'gpt-5.5',
      }),
      expect.objectContaining({
        id: 'gpt-5.5-pro',
        providerId: 'openai',
        providerModelId: 'gpt-5.5-pro',
      }),
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

  it('does not invent GPT-5.5 mini or nano variants', () => {
    const ids = MODELS.map(model => model.id);

    expect(ids).not.toContain('gpt-5.5-mini');
    expect(ids).not.toContain('gpt-5.5-nano');
    expect(ids).not.toContain('or-gpt-5.5-mini');
    expect(ids).not.toContain('or-gpt-5.5-nano');
  });

  it('includes the offline direct-image model', () => {
    expect(MODELS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'image-direct-comfy',
        providerId: 'local-image',
        providerModelId: 'comfy-direct',
        supportsTools: false,
      }),
    ]));
  });
});

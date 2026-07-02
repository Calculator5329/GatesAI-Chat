import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/core/models';
import type { Model } from '../../src/core/types';
import {
  computeUsageCostFromPricing,
  formatUsd,
  normalizeLlmUsageForModel,
} from '../../src/core/usage';

describe('usage cost math', () => {
  it('prefers provider-reported OpenRouter cost over pricing fallback', () => {
    const model = MODELS.find(item => item.id === 'or-gemini-3-flash');
    const normalized = normalizeLlmUsageForModel({
      providerId: 'openrouter',
      modelId: 'google/gemini-3-flash',
      promptTokens: 1_000,
      completionTokens: 500,
      costUsd: 0.1234,
    }, model);

    expect(normalized?.costUsd).toBe(0.1234);
    expect(normalized?.costSource).toBe('provider');
  });

  it('computes fallback cost using USD per million tokens', () => {
    const cost = computeUsageCostFromPricing(
      { promptTokens: 1_000, completionTokens: 400 },
      { prompt: 0.3, completion: 2.5 },
    );

    expect(cost).toBeCloseTo(0.0013);
  });

  it('stores zero cost for free OpenRouter and local model usage', () => {
    const free = MODELS.find(item => item.id === 'or-nemotron-3-ultra-free');
    const local: Model = {
      id: 'ollama-llama3',
      name: 'Llama 3',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3',
    };

    expect(normalizeLlmUsageForModel({
      providerId: 'openrouter',
      modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      promptTokens: 10,
      completionTokens: 5,
    }, free)).toMatchObject({ costUsd: 0, costSource: 'free' });

    expect(normalizeLlmUsageForModel({
      providerId: 'ollama',
      modelId: 'llama3',
      promptTokens: 10,
      completionTokens: 5,
    }, local)).toMatchObject({ costUsd: 0, costSource: 'local' });
  });

  it('formats sub-cent money with four decimals and cents-or-more with two', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.01)).toBe('$0.01');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

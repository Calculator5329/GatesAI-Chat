import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../../src/core/models';
import {
  bestLocalModel,
  bestSmallLocalModel,
  resolveBackgroundModelId,
  resolveDefaultModelId,
} from '../../src/core/defaultModel';
import type { Model } from '../../src/core/types';

function local(id: string, patch: Partial<Model> = {}): Model {
  return {
    id: `ollama-${id}`,
    name: id,
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId: id,
    dynamic: true,
    ...patch,
  };
}

const registry = {
  all: [] as Model[],
  findById: (id: string | undefined) => id ? ({ id } as Model) : undefined,
};

describe('resolveDefaultModelId', () => {
  it('uses the cloud default when an OpenRouter key exists', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: true,
      ollamaOnline: true,
      localModels: [local('qwen2.5:7b')],
      registry,
    })).toBe(DEFAULT_MODEL_ID);
  });

  it('uses the best local chat model when keyless and Ollama is online', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: false,
      ollamaOnline: true,
      localModels: [
        local('gemma2:9b', { supportsTools: false, contextLength: 128_000 }),
        local('qwen2.5:7b', { contextLength: 32_000 }),
      ],
      registry,
    })).toBe('ollama-qwen2.5:7b');
  });

  it('falls back to the cloud default when keyless local is offline or empty', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: false,
      ollamaOnline: false,
      localModels: [local('qwen2.5:7b')],
      registry,
    })).toBe(DEFAULT_MODEL_ID);
    expect(resolveDefaultModelId({
      hasOpenRouterKey: false,
      ollamaOnline: true,
      localModels: [],
      registry,
    })).toBe(DEFAULT_MODEL_ID);
  });

  it('excludes embedding tags and ranks tools, context, then catalog order', () => {
    const models = [
      local('nomic-embed-text:latest', { contextLength: 1_000_000 }),
      local('gemma2:9b', { supportsTools: false, contextLength: 1_000_000 }),
      local('mistral:7b', { contextLength: 32_000 }),
      local('qwen2.5:14b', { contextLength: 128_000 }),
      local('llama3.1:8b', { contextLength: 128_000 }),
    ];

    expect(bestLocalModel(models)?.providerModelId).toBe('qwen2.5:14b');
  });

  it('prefers small local models for background helpers after tool support', () => {
    expect(bestSmallLocalModel([
      local('qwen2.5:14b', { contextLength: 128_000 }),
      local('llama3.2:3b', { contextLength: 32_000 }),
    ])?.providerModelId).toBe('llama3.2:3b');
  });

  it('returns null for background helpers when neither cloud nor local is available', () => {
    expect(resolveBackgroundModelId({
      hasOpenRouterKey: false,
      ollamaOnline: false,
      localModels: [local('llama3.2:3b')],
      registry,
    })).toBeNull();
  });
});

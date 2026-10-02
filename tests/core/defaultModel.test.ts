import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../../src/core/models';
import {
  bestLocalModel,
  bestSmallLocalModel,
  resolveBackgroundModelId,
  resolveDefaultModelId,
} from '../../src/core/defaultModel';
import type { Model } from '../../src/core/types';
import type { OllamaCatalogModel } from '../../src/core/localModelMeta';
import { mapOllamaTagsToModels } from '../../src/services/llm/ollamaCatalog';

function local(id: string, patch: Partial<OllamaCatalogModel> = {}): OllamaCatalogModel {
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
      preferLocalModels: false,
      recentModelIds: [],
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
      preferLocalModels: false,
      recentModelIds: [],
    })).toBe('ollama-qwen2.5:7b');
  });

  it('falls back to the cloud default when keyless local is offline or empty', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: false,
      ollamaOnline: false,
      localModels: [local('qwen2.5:7b')],
      registry,
      preferLocalModels: false,
      recentModelIds: [],
    })).toBe(DEFAULT_MODEL_ID);
    expect(resolveDefaultModelId({
      hasOpenRouterKey: false,
      ollamaOnline: true,
      localModels: [],
      registry,
      preferLocalModels: false,
      recentModelIds: [],
    })).toBe(DEFAULT_MODEL_ID);
  });

  it('starts on a local model when preferLocalModels is on, even with an OpenRouter key', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: true,
      ollamaOnline: true,
      localModels: [local('gemma2:9b', { supportsTools: false }), local('qwen3.5:4b')],
      registry,
      preferLocalModels: true,
      recentModelIds: [],
    })).toBe('ollama-qwen3.5:4b');
  });

  it('keeps the cloud default with a key when preferLocalModels is off', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: true,
      ollamaOnline: true,
      localModels: [local('qwen3.5:4b')],
      registry,
      preferLocalModels: false,
      recentModelIds: ['ollama-qwen3.5:4b'],
    })).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps the cloud default when preferLocalModels is on but no local chat model is available', () => {
    const base = { hasOpenRouterKey: true, registry, preferLocalModels: true, recentModelIds: [] };
    expect(resolveDefaultModelId({ ...base, ollamaOnline: true, localModels: [local('nomic-embed-text:latest')] })).toBe(DEFAULT_MODEL_ID);
    expect(resolveDefaultModelId({ ...base, ollamaOnline: false, localModels: [local('qwen3.5:4b')] })).toBe(DEFAULT_MODEL_ID);
  });

  it('prefers the most recently picked local model that is still installed', () => {
    expect(resolveDefaultModelId({
      hasOpenRouterKey: true,
      ollamaOnline: true,
      localModels: [local('qwen3.5:9b', { maxContextLength: 262_144 }), local('gemma4:12b'), local('nomic-embed-text:latest')],
      registry,
      preferLocalModels: true,
      recentModelIds: ['or-claude-opus-5.5', 'ollama-mistral:7b', 'ollama-nomic-embed-text:latest', 'ollama-gemma4:12b', 'ollama-qwen3.5:9b'],
    })).toBe('ollama-gemma4:12b');
  });

  it('excludes embedding tags and ranks tools, parameter size, then catalog order', () => {
    const models = [
      local('nomic-embed-text:latest', { parameterBillions: 137 }),
      local('gemma2:9b', { supportsTools: false, parameterBillions: 9 }),
      local('mistral:latest', { parameterBillions: 7 }),
      local('house-chat:latest', { parameterBillions: 14.8 }),
      local('llama3.1:latest', { parameterBillions: 8 }),
      local('other-chat:latest', { parameterBillions: 14.8 }),
    ];

    expect(bestLocalModel(models)?.providerModelId).toBe('house-chat:latest');
  });

  it('picks the largest model when Ollama reports the same context for all of them', () => {
    const tags = {
      models: [
        { name: 'qwen3.5:4b', capabilities: ['completion', 'tools', 'thinking'], details: { parameter_size: '4B', context_length: 262_144 } },
        { name: 'gemma4:12b', capabilities: ['completion', 'tools', 'vision', 'thinking'], details: { parameter_size: '12.2B', context_length: 262_144 } },
        { name: 'qwen3.5:9b', capabilities: ['completion', 'tools', 'thinking'], details: { parameter_size: '9B', context_length: 262_144 } },
      ],
    };

    expect(bestLocalModel(mapOllamaTagsToModels(tags))?.providerModelId).toBe('gemma4:12b');
  });

  it('never picks an Ollama cloud model as the local default', () => {
    const cloud = local('gpt-oss:120b-cloud', { remoteHost: 'https://ollama.com:443', parameterBillions: 116.8 });
    const onDevice = local('qwen3.5:4b', { parameterBillions: 4 });
    const args = { hasOpenRouterKey: true, ollamaOnline: true, localModels: [cloud, onDevice], registry, preferLocalModels: true };

    expect(bestLocalModel([cloud, onDevice])).toBe(onDevice);
    expect(bestSmallLocalModel([cloud])).toBeUndefined();
    expect(resolveDefaultModelId({ ...args, recentModelIds: [cloud.id] })).toBe(onDevice.id);
  });

  it('prefers small local models for background helpers after tool support', () => {
    expect(bestSmallLocalModel([
      local('qwen2.5:14b'),
      local('qwen2.5:3b'),
    ])?.providerModelId).toBe('qwen2.5:3b');
  });

  it('returns null for background helpers when neither cloud nor local is available', () => {
    expect(resolveBackgroundModelId({
      hasOpenRouterKey: false,
      ollamaOnline: false,
      localModels: [local('qwen3.5:4b')],
      registry,
    })).toBeNull();
  });
});

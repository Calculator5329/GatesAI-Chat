import { describe, expect, it } from 'vitest';
import { mapOllamaTagsToModels } from '../../../src/services/llm/ollamaCatalog';
import { contextWindowFor } from '../../../src/core/tokens';

const TAGS_RESPONSE = {
  models: [
    { name: 'llama3.1:8b-instruct-q4_K_M', model: 'llama3.1:8b-instruct-q4_K_M', size: 4_700_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'gemma2:9b', model: 'gemma2:9b', size: 5_400_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'llama3.2-vision:11b', model: 'llama3.2-vision:11b', size: 7_900_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'qwen2.5:7b', model: 'qwen2.5:7b', size: 4_400_000_000, modified_at: '2026-04-20T00:00:00Z' },
  ],
};

describe('mapOllamaTagsToModels', () => {
  it('maps each tag into a Model with stable id and providerId', () => {
    const out = mapOllamaTagsToModels(TAGS_RESPONSE);
    expect(out).toHaveLength(4);
    const llama = out.find(m => m.providerModelId === 'llama3.1:8b-instruct-q4_K_M');
    expect(llama).toMatchObject({
      id: 'ollama-llama3.1:8b-instruct-q4_K_M',
      providerId: 'ollama',
      providerModelId: 'llama3.1:8b-instruct-q4_K_M',
      name: 'llama3.1:8b-instruct-q4_K_M',
      vendor: 'Ollama',
      dynamic: true,
    });
  });

  it('marks vision models with supportsVision: true', () => {
    const out = mapOllamaTagsToModels(TAGS_RESPONSE);
    expect(out.find(m => m.providerModelId === 'llama3.2-vision:11b')?.supportsVision).toBe(true);
    expect(out.find(m => m.providerModelId === 'llama3.1:8b-instruct-q4_K_M')?.supportsVision).toBe(false);
  });

  it('marks known-bad tool families with supportsTools: false', () => {
    const fixture = {
      models: [
        { name: 'gemma:latest' },
        { name: 'gemma2:9b' },
        { name: 'gemma3:27b' },
        { name: 'phi' },
        { name: 'phi3:mini' },
        { name: 'phi4:14b' },
        { name: 'PHI3:Latest' },          // case-insensitive
        { name: 'codellama' },
        { name: 'codellama:13b' },
        { name: 'qwen2.5:7b' },
        { name: 'llama3.1:8b' },
        { name: 'phind-codellama:34b' },  // not at start, must NOT match
      ],
    } as unknown;
    const out = mapOllamaTagsToModels(fixture);
    const tools = (id: string) => out.find(m => m.providerModelId === id)?.supportsTools;

    // Blocklist hits
    expect(tools('gemma:latest')).toBe(false);
    expect(tools('gemma2:9b')).toBe(false);
    expect(tools('gemma3:27b')).toBe(false);
    expect(tools('phi')).toBe(false);
    expect(tools('phi3:mini')).toBe(false);
    expect(tools('phi4:14b')).toBe(false);
    expect(tools('PHI3:Latest')).toBe(false);
    expect(tools('codellama')).toBe(false);
    expect(tools('codellama:13b')).toBe(false);

    // Non-blocklist
    expect(tools('qwen2.5:7b')).toBe(true);
    expect(tools('llama3.1:8b')).toBe(true);
    expect(tools('phind-codellama:34b')).toBe(true); // doesn't start with 'codellama'
  });

  it('filters embedding-only tags out of the chat model catalog', () => {
    const out = mapOllamaTagsToModels({
      models: [
        { name: 'nomic-embed-text:latest' },
        { name: 'mxbai-embed-large:latest' },
        { name: 'all-minilm:latest' },
        { name: 'bge-m3:latest' },
        { name: 'custom-embed:latest' },
        { name: 'llama3.1:8b' },
      ],
    });

    expect(out.map(m => m.providerModelId)).toEqual(['llama3.1:8b']);
  });

  it('trusts reported capabilities over the name rules', () => {
    const out = mapOllamaTagsToModels({
      models: [
        {
          name: 'gemma4:12b',
          capabilities: ['completion', 'vision', 'audio', 'tools', 'thinking'],
          details: { parameter_size: '12B', context_length: 262_144 },
        },
        { name: 'qwen2.5:3b', capabilities: ['completion'], details: { context_length: 32_768 } },
        { name: 'house-embedder:latest', capabilities: ['embedding'], details: { embedding_length: 768 } },
        { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
      ],
    });

    expect(out.map(m => m.providerModelId)).toEqual(['gemma4:12b', 'qwen2.5:3b']);
    expect(out[0]).toMatchObject({ supportsTools: true, supportsVision: true, supportsThinking: true });
    expect(out[1]).toMatchObject({ supportsTools: false, supportsVision: false, supportsThinking: false });
  });

  it('keeps the reported context as a ceiling and budgets against the Ollama default', () => {
    const [gemma] = mapOllamaTagsToModels({
      models: [{ name: 'gemma4:12b', capabilities: ['completion', 'tools'], details: { context_length: 262_144 } }],
    });

    expect(gemma).not.toHaveProperty('contextLength');
    expect(gemma?.maxContextLength).toBe(262_144);
    expect(contextWindowFor(gemma)).toBe(8_000);
  });

  it('parses the reported parameter size into billions', () => {
    const out = mapOllamaTagsToModels({
      models: [
        { name: 'gemma4:12b', details: { parameter_size: '12.2B' } },
        { name: 'qwen3.5:4b', details: { parameter_size: '4B' } },
        { name: 'tiny:latest', details: { parameter_size: '567M' } },
        { name: 'odd:latest', details: { parameter_size: 'unknown' } },
      ],
    });

    expect(out[0]?.parameterBillions).toBe(12.2);
    expect(out[1]?.parameterBillions).toBe(4);
    expect(out[2]?.parameterBillions).toBeCloseTo(0.567);
    expect(out[3]).not.toHaveProperty('parameterBillions');
  });

  it('keeps Ollama cloud models in the catalog, marked with their remote host', () => {
    const out = mapOllamaTagsToModels({
      models: [
        { name: 'gpt-oss:120b-cloud', remote_model: 'gpt-oss:120b', remote_host: 'https://ollama.com:443', capabilities: ['completion', 'tools'] },
        { name: 'qwen3.5:4b', capabilities: ['completion', 'tools'] },
      ],
    });

    expect(out.map(m => m.providerModelId)).toEqual(['gpt-oss:120b-cloud', 'qwen3.5:4b']);
    expect(out[0]?.remoteHost).toBe('https://ollama.com:443');
    expect(out[1]).not.toHaveProperty('remoteHost');
  });

  it('falls back to the name rules per entry when capabilities are absent', () => {
    const out = mapOllamaTagsToModels({
      models: [
        { name: 'gemma2:9b', details: { parameter_size: '9B' } },
        { name: 'gemma4:12b', capabilities: ['completion', 'tools'] },
      ],
    });

    expect(out[0]).toMatchObject({ providerModelId: 'gemma2:9b', supportsTools: false });
    expect(out[0]).not.toHaveProperty('supportsThinking');
    expect(out[0]).not.toHaveProperty('contextLength');
    expect(out[1]).toMatchObject({ providerModelId: 'gemma4:12b', supportsTools: true });
  });

  it('returns [] when the response is malformed', () => {
    expect(mapOllamaTagsToModels(null)).toEqual([]);
    expect(mapOllamaTagsToModels({})).toEqual([]);
    expect(mapOllamaTagsToModels({ models: 'not-an-array' })).toEqual([]);
  });
});

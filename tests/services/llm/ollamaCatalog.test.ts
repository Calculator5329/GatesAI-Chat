import { describe, expect, it } from 'vitest';
import { mapOllamaTagsToModels } from '../../../src/services/llm/ollamaCatalog';

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

  it('returns [] when the response is malformed', () => {
    expect(mapOllamaTagsToModels(null)).toEqual([]);
    expect(mapOllamaTagsToModels({})).toEqual([]);
    expect(mapOllamaTagsToModels({ models: 'not-an-array' })).toEqual([]);
  });
});

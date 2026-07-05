import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOpenAiCompatModels,
  isBlockedHttpRemoteEndpoint,
  mapOpenAiCompatModels,
  normalizeOpenAiCompatBaseUrl,
} from '../../src/services/llm/openaiCompatCatalog';

describe('OpenAI-compatible endpoint catalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes base URLs to the /v1 API root without doubling it', () => {
    expect(normalizeOpenAiCompatBaseUrl(' http://127.0.0.1:1234 ')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeOpenAiCompatBaseUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeOpenAiCompatBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeOpenAiCompatBaseUrl('https://models.example.test/api')).toBe('https://models.example.test/api/v1');
    expect(normalizeOpenAiCompatBaseUrl('')).toBe('');
  });

  it('detects CSP-blocked http remote endpoints', () => {
    expect(isBlockedHttpRemoteEndpoint('http://192.168.1.20:8000')).toBe(true);
    expect(isBlockedHttpRemoteEndpoint('http://localhost:1234')).toBe(false);
    expect(isBlockedHttpRemoteEndpoint('http://127.0.0.1:8080')).toBe(false);
    expect(isBlockedHttpRemoteEndpoint('https://192.168.1.20:8000')).toBe(false);
  });

  it('maps /models payloads to stable custom provider ids', () => {
    const out = mapOpenAiCompatModels({
      data: [
        { id: 'qwen/qwen3-8b' },
        { id: 'llama-3.2-3b-instruct' },
        { id: 'qwen/qwen3-8b' },
        { id: '' },
      ],
    }, 'LM Studio');

    expect(out).toEqual([
      expect.objectContaining({
        id: 'oc-qwen_qwen3-8b',
        providerId: 'openai-compat',
        providerModelId: 'qwen/qwen3-8b',
        name: 'qwen/qwen3-8b',
        vendor: 'LM Studio',
        supportsTools: true,
      }),
      expect.objectContaining({
        id: 'oc-llama-3.2-3b-instruct',
        providerModelId: 'llama-3.2-3b-instruct',
      }),
    ]);
    expect(out[0].contextLength).toBeUndefined();
  });

  it('keeps registry ids stable across refreshes for the same endpoint model id', () => {
    const first = mapOpenAiCompatModels({ data: [{ id: 'local/model:latest' }] });
    const second = mapOpenAiCompatModels({ data: [{ id: 'local/model:latest' }] });

    expect(first[0].id).toBe('oc-local_model_latest');
    expect(second[0].id).toBe(first[0].id);
  });

  it('fetches /models with normalized URL and optional auth', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'local-model' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchOpenAiCompatModels({
      baseUrl: 'http://localhost:1234/',
      apiKey: ' sk-local ',
      label: 'LocalAI',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-local' },
      }),
    );
    expect(out[0]).toEqual(expect.objectContaining({
      id: 'oc-local-model',
      vendor: 'LocalAI',
    }));
  });
});

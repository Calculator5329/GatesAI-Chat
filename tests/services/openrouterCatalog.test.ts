import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenRouterModels } from '../../src/services/llm/openrouterCatalog';

const SAMPLE = {
  data: [
    {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Anthropic: Claude 3.5 Sonnet',
      description: 'Smart sonnet',
      context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { output_modalities: ['text'] },
    },
    {
      id: 'openai/whisper-1',
      name: 'Whisper',
      architecture: { output_modalities: ['audio'] },
    },
    {
      id: 'meta-llama/llama-3.1-70b-instruct',
      name: 'Llama 3.1 70B',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
    },
  ],
};

describe('fetchOpenRouterModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => SAMPLE,
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops audio-only entries and keeps chat models', async () => {
    const out = await fetchOpenRouterModels();
    expect(out.map(m => m.providerModelId)).toEqual([
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-70b-instruct',
    ]);
  });

  it('namespaces ids and infers vendors', async () => {
    const out = await fetchOpenRouterModels();
    const claude = out.find(m => m.providerModelId === 'anthropic/claude-3.5-sonnet')!;
    expect(claude.id).toBe('or-live-anthropic_claude-3.5-sonnet');
    expect(claude.vendor).toBe('Anthropic');
    expect(claude.providerId).toBe('openrouter');
    expect(claude.dynamic).toBe(true);
  });

  it('converts pricing from per-token strings to USD per 1M tokens', async () => {
    const out = await fetchOpenRouterModels();
    const claude = out.find(m => m.providerModelId === 'anthropic/claude-3.5-sonnet')!;
    expect(claude.pricing?.prompt).toBeCloseTo(3, 5);
    expect(claude.pricing?.completion).toBeCloseTo(15, 5);
    expect(claude.contextLength).toBe(200000);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'X' })));
    await expect(fetchOpenRouterModels()).rejects.toThrow(/500/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterStore } from '../../src/stores/OpenRouterStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';

const ONE_MODEL = {
  data: [{
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude',
    context_length: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    architecture: { output_modalities: ['text'] },
  }],
};

describe('OpenRouterStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    clearAppStorage();
    vi.unstubAllGlobals();
  });

  it('starts empty when no cache exists', () => {
    const store = new OpenRouterStore(new ModelRegistry());
    expect(store.count).toBe(0);
    expect(store.fetchedAt).toBeNull();
    expect(store.fetching).toBe(false);
  });

  it('refresh() fetches, updates registry, and persists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ONE_MODEL })));
    const registry = new ModelRegistry();
    const store = new OpenRouterStore(registry);
    await store.refresh();
    expect(store.count).toBe(1);
    expect(store.fetchedAt).toBeTypeOf('number');
    expect(store.fetchError).toBeNull();
    expect(registry.all.some(m => m.dynamic && m.providerModelId === 'anthropic/claude-3.5-sonnet')).toBe(true);

    // New store reads the cache and rehydrates the registry without a fetch.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not be called'); }));
    const registry2 = new ModelRegistry();
    const store2 = new OpenRouterStore(registry2);
    expect(store2.count).toBe(1);
    expect(registry2.all.some(m => m.dynamic)).toBe(true);
  });

  it('refresh() captures network errors in fetchError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const store = new OpenRouterStore(new ModelRegistry());
    await store.refresh();
    expect(store.fetchError).toBe('offline');
    expect(store.fetching).toBe(false);
  });

  it('clearCache() empties the registry slice and storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ONE_MODEL })));
    const registry = new ModelRegistry();
    const store = new OpenRouterStore(registry);
    await store.refresh();
    store.clearCache();
    expect(store.count).toBe(0);
    expect(store.fetchedAt).toBeNull();
    expect(registry.all.every(m => !m.dynamic)).toBe(true);
  });
});

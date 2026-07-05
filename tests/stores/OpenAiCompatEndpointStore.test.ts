import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { OpenAiCompatEndpointStore } from '../../src/stores/OpenAiCompatEndpointStore';
import { clearAppStorage } from '../helpers/storage';

describe('OpenAiCompatEndpointStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAppStorage();
  });

  it('sets registry models and availability after a successful probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen/qwen3' }] }),
    })));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry, undefined, { autoPersist: false });
    const store = new OpenAiCompatEndpointStore(registry, providers);

    store.setBaseUrl('http://localhost:1234');
    store.setLabel('LM Studio');
    const ok = await store.test();

    expect(ok).toBe(true);
    expect(providers.getConfig('openai-compat').available).toBe(true);
    expect(providers.getConfig('openai-compat').baseUrl).toBe('http://localhost:1234/v1');
    expect(registry.dynamicForProvider('openai-compat')).toEqual([
      expect.objectContaining({
        id: 'oc-qwen_qwen3',
        providerId: 'openai-compat',
        providerModelId: 'qwen/qwen3',
        vendor: 'LM Studio',
      }),
    ]);
  });

  it('clears availability and hides models after a failed probe', async () => {
    const registry = new ModelRegistry();
    registry.setDynamicForProvider('openai-compat', [{
      id: 'oc-old',
      name: 'old',
      vendor: 'Custom',
      providerId: 'openai-compat',
      providerModelId: 'old',
      dynamic: true,
    }]);
    const providers = new ProviderStore(registry, undefined, { autoPersist: false });
    providers.setBaseUrl('openai-compat', 'http://localhost:1234');
    providers.setAvailable('openai-compat', true);
    const store = new OpenAiCompatEndpointStore(registry, providers);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Down' })));

    const ok = await store.test();

    expect(ok).toBe(false);
    expect(providers.getConfig('openai-compat').available).toBe(false);
    expect(registry.dynamicForProvider('openai-compat')).toEqual([]);
    expect(store.lastError).toContain('503');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { loadProviderConfigs } from '../../src/services/providerStorage';
import { clearAppStorage } from '../helpers/storage';
import { flush } from '../helpers/mockProvider';

const make = () => new ProviderStore(new ModelRegistry());

describe('ProviderStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('starts empty and reports providers as not connected', () => {
    const store = make();
    expect(store.configs).toEqual({});
    expect(store.isConnected('openrouter')).toBe(false);
  });

  it('setKey marks OpenRouter connected and routes through the real impl', () => {
    const store = make();
    store.setKey('openrouter', 'sk-test');
    expect(store.isConnected('openrouter')).toBe(true);
    expect(store.getConfig('openrouter').apiKey).toBe('sk-test');
  });

  it('setKey with empty string clears the key', () => {
    const store = make();
    store.setKey('openrouter', 'sk-test');
    store.setKey('openrouter', '');
    expect(store.isConnected('openrouter')).toBe(false);
    expect(store.getConfig('openrouter').apiKey).toBeUndefined();
  });

  it('persists configs across instances', async () => {
    const a = make();
    a.setKey('openrouter', 'sk-or-test');
    await flush(2);

    const b = make();
    expect(b.getConfig('openrouter').apiKey).toBe('sk-or-test');
  });

  it('persists custom endpoint config and normalizes its base URL', async () => {
    const a = make();
    a.setBaseUrl('openai-compat', 'http://localhost:1234/');
    a.setLabel('openai-compat', 'LM Studio');
    a.setAvailable('openai-compat', true);
    a.setKey('openai-compat', 'sk-local');
    await flush(2);

    const b = make();
    expect(b.getConfig('openai-compat')).toEqual({
      baseUrl: 'http://localhost:1234/v1',
      label: 'LM Studio',
      available: true,
      apiKey: 'sk-local',
    });
  });

  it('strips retired direct-provider configs from legacy storage', () => {
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({
      openrouter: { apiKey: 'sk-or' },
      openai: { apiKey: 'sk-openai' },
      anthropic: { apiKey: 'sk-anthropic' },
      local: { baseUrl: 'http://127.0.0.1:8080/v1' },
    }));
    localStorage.setItem('gatesai.routing.v1', JSON.stringify({ defaultProvider: 'direct' }));

    expect(loadProviderConfigs()).toEqual({ openrouter: { apiKey: 'sk-or' } });
    expect(localStorage.getItem('gatesai.routing.v1')).toBeNull();
  });

  it('migrates older OpenRouter key shapes into the supported provider config', () => {
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({
      openRouterApiKey: ' sk-legacy ',
      openai: { apiKey: 'sk-openai' },
    }));

    expect(loadProviderConfigs()).toEqual({ openrouter: { apiKey: 'sk-legacy' } });
  });

  it('hasUsableProvider reacts to key changes', async () => {
    const store = make();
    expect(store.hasUsableProvider).toBe(false);
    store.setKey('openrouter', 'sk-test');
    await flush(2);
    expect(store.hasUsableProvider).toBe(true);
    store.setKey('openrouter', '');
    await flush(2);
    expect(store.hasUsableProvider).toBe(false);
  });

  it('hasUsableProvider reacts to custom endpoint probe availability', async () => {
    const registry = new ModelRegistry();
    registry.setDynamicForProvider('openai-compat', [{
      id: 'oc-local-model',
      name: 'local-model',
      vendor: 'Custom',
      providerId: 'openai-compat',
      providerModelId: 'local-model',
      dynamic: true,
    }]);
    const store = new ProviderStore(registry);
    store.setBaseUrl('openai-compat', 'http://localhost:1234');
    await flush(2);
    expect(store.hasUsableProvider).toBe(false);
    store.setAvailable('openai-compat', true);
    await flush(2);
    expect(store.hasUsableProvider).toBe(true);
    store.setAvailable('openai-compat', false);
    await flush(2);
    expect(store.hasUsableProvider).toBe(false);
  });

  it('remove deletes an entire provider entry', () => {
    const store = make();
    store.setKey('openrouter', 'sk-test');
    store.remove('openrouter');
    expect(store.configs.openrouter).toBeUndefined();
  });
});

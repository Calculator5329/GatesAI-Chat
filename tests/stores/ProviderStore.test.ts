import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
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

  it('remove deletes an entire provider entry', () => {
    const store = make();
    store.setKey('openrouter', 'sk-test');
    store.remove('openrouter');
    expect(store.configs.openrouter).toBeUndefined();
  });
});

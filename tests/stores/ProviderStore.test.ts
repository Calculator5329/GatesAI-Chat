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
    expect(store.isConnected('openai')).toBe(false);
    // local doesn't need a key — always connected
    expect(store.isConnected('local')).toBe(true);
  });

  it('setKey marks the provider connected and routes through the real impl', () => {
    const store = make();
    store.setKey('openai', 'sk-test');
    expect(store.isConnected('openai')).toBe(true);
    expect(store.getConfig('openai').apiKey).toBe('sk-test');
  });

  it('setKey with empty string clears the key', () => {
    const store = make();
    store.setKey('openai', 'sk-test');
    store.setKey('openai', '');
    expect(store.isConnected('openai')).toBe(false);
    expect(store.getConfig('openai').apiKey).toBeUndefined();
  });

  it('persists configs across instances', async () => {
    const a = make();
    a.setKey('groq', 'gsk-test');
    a.setBaseUrl('local', 'http://127.0.0.1:8080/v1');
    await flush(2);

    const b = make();
    expect(b.getConfig('groq').apiKey).toBe('gsk-test');
    expect(b.getConfig('local').baseUrl).toBe('http://127.0.0.1:8080/v1');
  });

  it('hasUsableProvider reacts to key changes', async () => {
    const store = make();
    expect(store.hasUsableProvider).toBe(false);
    store.setKey('openai', 'sk-test');
    await flush(2);
    expect(store.hasUsableProvider).toBe(true);
    store.setKey('openai', '');
    await flush(2);
    expect(store.hasUsableProvider).toBe(false);
  });

  it('remove deletes an entire provider entry', () => {
    const store = make();
    store.setKey('gemini', 'g-test');
    store.remove('gemini');
    expect(store.configs.gemini).toBeUndefined();
  });
});

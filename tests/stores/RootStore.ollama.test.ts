import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { RootStore } from '../../src/stores/RootStore';
import { clearAppStorage } from '../helpers/storage';

// We use a fresh RootStore per test (it's normally a singleton, but the
// class itself is exported and re-instantiable). Storage is wiped in
// beforeEach so the store starts at defaults.
//
// RootStore boots BridgeStore.start() and SummaryStore.start() which can
// schedule background work (fetch polling, timers). We stub fetch to a
// harmless rejection so the bridge poll doesn't blow up against jsdom.
describe('RootStore — Ollama config bridge', () => {
  beforeEach(() => {
    clearAppStorage();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in test'); }));
  });
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); });

  it('overlays LocalRuntimeStore.ollamaBaseUrl into ProviderStore.effectiveConfigs.ollama', () => {
    const root = new RootStore();
    expect(root.providers.effectiveConfigs.ollama?.baseUrl).toBe(root.localRuntime.ollamaBaseUrl);
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBe(root.ollama.config.apiKey);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(root.ollama.config.toolsEnabled);
  });

  it('reflects setToolsEnabled toggles into effectiveConfigs.ollama', () => {
    const root = new RootStore();
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(true);
    root.ollama.setToolsEnabled(false);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(false);
    root.ollama.setToolsEnabled(true);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(true);
  });

  it('reflects local.setBaseUrl into effectiveConfigs.ollama.baseUrl', () => {
    const root = new RootStore();
    root.localRuntime.setBaseUrl('ollama', 'http://10.0.0.7:11434');
    expect(root.providers.effectiveConfigs.ollama?.baseUrl).toBe('http://10.0.0.7:11434');
  });

  it('reflects setKey changes', () => {
    const root = new RootStore();
    root.ollama.setKey('hunter2');
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBe('hunter2');
    root.ollama.setKey('');
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBeUndefined();
  });

  it('does not treat a cached Ollama catalog as locally available while runtime is offline', () => {
    const root = new RootStore();
    runInAction(() => {
      root.localRuntime.runtimes.ollama.status = 'offline';
      root.ollama.catalog = [{
        id: 'ollama-gpt-oss:20b',
        name: 'gpt-oss:20b',
        providerId: 'ollama',
        providerModelId: 'gpt-oss:20b',
        vendor: 'Ollama',
        contextWindow: 8000,
      }];
      root.registry.setDynamicForProvider('ollama', root.ollama.catalog);
    });

    expect(root.providers.effectiveConfigs.ollama?.available).toBe(false);
    expect(root.providers.isConnected('ollama')).toBe(false);
  });

  it('treats a cached Ollama catalog as locally available when runtime is online', () => {
    const root = new RootStore();
    runInAction(() => {
      root.localRuntime.runtimes.ollama.status = 'online';
      root.ollama.catalog = [{
        id: 'ollama-gpt-oss:20b',
        name: 'gpt-oss:20b',
        providerId: 'ollama',
        providerModelId: 'gpt-oss:20b',
        vendor: 'Ollama',
        contextWindow: 8000,
      }];
      root.registry.setDynamicForProvider('ollama', root.ollama.catalog);
    });

    expect(root.providers.effectiveConfigs.ollama?.available).toBe(true);
    expect(root.providers.isConnected('ollama')).toBe(true);
  });
});

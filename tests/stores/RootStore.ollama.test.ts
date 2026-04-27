import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('mirrors OllamaStore.config into ProviderStore.configs.ollama on first init', () => {
    const root = new RootStore();
    expect(root.providers.configs.ollama).toEqual({
      baseUrl: root.ollama.config.baseUrl,
      apiKey: root.ollama.config.apiKey,
      toolsEnabled: root.ollama.config.toolsEnabled,
    });
  });

  it('reflects setToolsEnabled toggles into ProviderStore.configs.ollama', () => {
    const root = new RootStore();
    expect(root.providers.configs.ollama?.toolsEnabled).toBe(true);
    root.ollama.setToolsEnabled(false);
    // autorun is synchronous — mirror should be visible immediately.
    expect(root.providers.configs.ollama?.toolsEnabled).toBe(false);
    root.ollama.setToolsEnabled(true);
    expect(root.providers.configs.ollama?.toolsEnabled).toBe(true);
  });

  it('reflects setBaseUrl changes', () => {
    const root = new RootStore();
    root.ollama.setBaseUrl('http://10.0.0.7:11434');
    expect(root.providers.configs.ollama?.baseUrl).toBe('http://10.0.0.7:11434');
  });

  it('reflects setKey changes', () => {
    const root = new RootStore();
    root.ollama.setKey('hunter2');
    expect(root.providers.configs.ollama?.apiKey).toBe('hunter2');
    root.ollama.setKey('');
    expect(root.providers.configs.ollama?.apiKey).toBeUndefined();
  });
});

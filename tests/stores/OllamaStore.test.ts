import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaStore } from '../../src/stores/OllamaStore';
import { LocalRuntimeStore } from '../../src/stores/LocalRuntimeStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';

const TAGS_OK = {
  models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4.7e9, modified_at: '2026-04-20T00:00:00Z' }],
};

function makeLocalRuntime(): LocalRuntimeStore {
  return new LocalRuntimeStore({
    service: {
      startRuntime: async () => {},
      stopRuntime: async () => {},
      getRuntimeStatus: async () => ({ running: false, status: 'stopped', logs: [] }),
      probeHttp: async () => {},
      fetchOllamaTags: async () => ({ models: [] }),
      pathExists: async () => false,
      pickDirectory: async () => null,
      pickFile: async () => null,
      getCandidatePaths: async () => null,
    },
    autoDetect: async () => ({}),
  });
}

describe('OllamaStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); });

  it('starts with empty catalog and reads URL from LocalRuntimeStore', () => {
    const local = makeLocalRuntime();
    const store = new OllamaStore(new ModelRegistry(), local);
    expect(local.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(store.catalog).toEqual([]);
    expect(store.config.toolsEnabled).toBe(true);
  });

  it('derives online from LocalRuntimeStore status', () => {
    const local = makeLocalRuntime();
    const store = new OllamaStore(new ModelRegistry(), local);
    expect(store.online).toBe(false);
    runInAction(() => { local.runtimes.ollama.status = 'online'; });
    expect(store.online).toBe(true);
    runInAction(() => { local.runtimes.ollama.status = 'offline'; });
    expect(store.online).toBe(false);
  });

  it('refresh() loads /api/tags through LocalRuntimeStore', async () => {
    const fetchTags = vi.fn(async () => TAGS_OK);
    const reg = new ModelRegistry();
    const local = makeLocalRuntime();
    (local as unknown as { service: { fetchOllamaTags: typeof fetchTags } }).service.fetchOllamaTags = fetchTags;
    local.setBaseUrl('ollama', 'http://10.0.0.5:11434');
    const store = new OllamaStore(reg, local);
    await store.refresh();
    expect(fetchTags).toHaveBeenCalledWith('http://10.0.0.5:11434', undefined);
    expect(store.catalog).toHaveLength(1);
    expect(store.lastError).toBeUndefined();
    expect(reg.all.some(m => m.providerId === 'ollama' && m.providerModelId === 'llama3.1:8b')).toBe(true);
  });

  it('refresh() captures network errors into lastError', async () => {
    const local = makeLocalRuntime();
    (local as unknown as { service: { fetchOllamaTags: () => Promise<unknown> } }).service.fetchOllamaTags = async () => { throw new Error('ECONNREFUSED'); };
    const store = new OllamaStore(new ModelRegistry(), local);
    await store.refresh();
    expect(store.lastError).toMatch(/ECONNREFUSED/);
  });

  it('persists auth/catalog; new store rehydrates without a fetch', async () => {
    const local = makeLocalRuntime();
    (local as unknown as { service: { fetchOllamaTags: () => Promise<unknown> } }).service.fetchOllamaTags = async () => TAGS_OK;
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, local);
    await store.refresh();

    const local2 = makeLocalRuntime();
    (local2 as unknown as { service: { fetchOllamaTags: () => Promise<unknown> } }).service.fetchOllamaTags = async () => { throw new Error('should not be called'); };
    const reg2 = new ModelRegistry();
    const store2 = new OllamaStore(reg2, local2);
    expect(store2.catalog).toHaveLength(1);
    expect(reg2.all.some(m => m.providerId === 'ollama')).toBe(true);
  });

  it('setKey / setToolsEnabled mutate config', () => {
    const store = new OllamaStore(new ModelRegistry(), makeLocalRuntime());
    store.setKey('hunter2');
    expect(store.config.apiKey).toBe('hunter2');
    store.setKey('');
    expect(store.config.apiKey).toBeUndefined();
    store.setToolsEnabled(false);
    expect(store.config.toolsEnabled).toBe(false);
  });

  it('clearCatalog() empties the registry slice and storage', async () => {
    const local = makeLocalRuntime();
    (local as unknown as { service: { fetchOllamaTags: () => Promise<unknown> } }).service.fetchOllamaTags = async () => TAGS_OK;
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, local);
    await store.refresh();
    store.clearCatalog();
    expect(store.catalog).toEqual([]);
    expect(reg.all.some(m => m.providerId === 'ollama')).toBe(false);
  });
});

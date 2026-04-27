import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaStore } from '../../src/stores/OllamaStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';

const TAGS_OK = {
  models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4.7e9, modified_at: '2026-04-20T00:00:00Z' }],
};

describe('OllamaStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); });

  it('starts with default base URL and empty catalog', () => {
    const store = new OllamaStore(new ModelRegistry());
    expect(store.config.baseUrl).toBe('http://127.0.0.1:11434');
    expect(store.catalog).toEqual([]);
    expect(store.state).toBe('unknown');
  });

  it('refresh() hits /api/tags and pushes models into the registry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();
    expect(store.catalog).toHaveLength(1);
    expect(store.state).toBe('online');
    expect(store.lastError).toBeUndefined();
    expect(reg.all.some(m => m.providerId === 'ollama' && m.providerModelId === 'llama3.1:8b')).toBe(true);
  });

  it('refresh() captures network errors and flips state to offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const store = new OllamaStore(new ModelRegistry());
    await store.refresh();
    expect(store.state).toBe('offline');
    expect(store.lastError).toMatch(/ECONNREFUSED/);
  });

  it('persists config and catalog; new store rehydrates without a fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();

    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not be called'); }));
    const reg2 = new ModelRegistry();
    const store2 = new OllamaStore(reg2);
    expect(store2.catalog).toHaveLength(1);
    expect(reg2.all.some(m => m.providerId === 'ollama')).toBe(true);
  });

  it('setBaseUrl / setKey / setToolsEnabled mutate config', () => {
    const store = new OllamaStore(new ModelRegistry());
    store.setBaseUrl('http://10.0.0.5:11434/');
    expect(store.config.baseUrl).toBe('http://10.0.0.5:11434');
    store.setKey('hunter2');
    expect(store.config.apiKey).toBe('hunter2');
    store.setKey('');
    expect(store.config.apiKey).toBeUndefined();
    store.setToolsEnabled(false);
    expect(store.config.toolsEnabled).toBe(false);
  });

  it('clearCatalog() empties the registry slice and storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();
    store.clearCatalog();
    expect(store.catalog).toEqual([]);
    expect(reg.all.some(m => m.providerId === 'ollama')).toBe(false);
  });

  it('startStatusPoll fires refresh immediately and on every interval', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response);
      vi.stubGlobal('fetch', fetchMock);
      const store = new OllamaStore(new ModelRegistry());

      store.startStatusPoll(1000);

      // Initial fire — flush the synchronous void refresh()
      await Promise.resolve();
      await Promise.resolve();
      const afterInitial = fetchMock.mock.calls.length;
      expect(afterInitial).toBeGreaterThanOrEqual(1);

      // Advance two intervals
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock.mock.calls.length).toBe(afterInitial + 2);

      store.stopStatusPoll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('multiple subscribers share a single timer', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response);
      vi.stubGlobal('fetch', fetchMock);
      const store = new OllamaStore(new ModelRegistry());

      store.startStatusPoll(1000);
      store.startStatusPoll(1000); // second subscriber, no new timer
      await vi.runOnlyPendingTimersAsync();
      // Two start calls means refresh() was kicked twice immediately,
      // but the interval timer is shared.
      const initialCalls = fetchMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock.mock.calls.length).toBe(initialCalls + 1);

      // Drop one subscriber — timer should keep running.
      store.stopStatusPoll();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock.mock.calls.length).toBe(initialCalls + 2);

      // Drop last subscriber — timer stops.
      store.stopStatusPoll();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock.mock.calls.length).toBe(initialCalls + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopStatusPoll without matching start warns but does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new OllamaStore(new ModelRegistry());
    expect(() => store.stopStatusPoll()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stopStatusPoll called without a matching start'));
    warnSpy.mockRestore();
  });
});

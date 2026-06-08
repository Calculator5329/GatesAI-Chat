import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createJsonPersistenceProvider,
  installMultiTabStorageListener,
  type KeyValuePersistence,
} from '../../../src/services/storage/persistenceProvider';
import { logger } from '../../../src/services/diagnostics/logger';
import { createLocalChatSnapshotPersistenceProvider } from '../../../src/services/persistence';
import { createProviderConfigsPersistence } from '../../../src/services/providerStorage';

describe('persistence providers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips JSON through an injected key-value backend', () => {
    const storage = memoryStorage();
    const provider = createJsonPersistenceProvider({
      key: 'slot',
      storage,
      parse: raw => {
        const r = raw && typeof raw === 'object' ? raw as { value?: unknown } : {};
        return { value: typeof r.value === 'string' ? r.value : 'default' };
      },
    });

    expect(provider.load()).toEqual({ value: 'default' });
    provider.save({ value: 'saved' });
    expect(provider.load()).toEqual({ value: 'saved' });
    provider.clear();
    expect(provider.load()).toEqual({ value: 'default' });
  });

  it('falls back through the parser when stored JSON is malformed', () => {
    const storage = memoryStorage({ slot: '{not json' });
    const provider = createJsonPersistenceProvider({
      key: 'slot',
      storage,
      parse: raw => raw ?? 'fallback',
    });

    expect(provider.load()).toBe('fallback');
  });

  it('swallows write and clear failures from the backend', () => {
    const storage: KeyValuePersistence = {
      getItem: () => null,
      setItem: () => { throw new Error('no writes'); },
      removeItem: () => { throw new Error('no clears'); },
    };
    const provider = createJsonPersistenceProvider({
      key: 'slot',
      storage,
      parse: () => null,
    });

    expect(() => provider.save(null)).not.toThrow();
    expect(() => provider.clear()).not.toThrow();
  });

  it('keeps chat migration and emergency compaction behind the provider port', () => {
    const storage = quotaStorage(2_000);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = createLocalChatSnapshotPersistenceProvider(storage);
    const snapshot = {
      threads: [{
        id: 't1',
        title: 'big result',
        subtitle: '',
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: 'a1',
          role: 'assistant' as const,
          content: 'done',
          createdAt: 3,
          toolResults: [{
            toolCallId: 'c1',
            toolName: 'fs',
            content: 'path: /workspace/artifacts/huge.json\n' + 'x'.repeat(20_000),
            ranAt: 4,
          }],
        }],
      }],
      activeThreadId: 't1',
    };

    provider.save(snapshot);

    const loaded = provider.load();
    const message = loaded?.threads[0].messages[0];
    expect(message?.role).toBe('assistant');
    if (message?.role !== 'assistant') throw new Error('expected assistant');
    expect(message.toolResults?.[0].content).toContain('[persisted tool result compacted]');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[1]).toContain('attempting compaction');
    expect(warnSpy.mock.calls[1]?.[1]).toContain('saved compacted chat snapshot');
  });

  it('installMultiTabStorageListener warns on cross-tab gatesai.* storage changes', () => {
    const listeners = new Map<string, EventListener>();
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      listeners.set(type, handler as EventListener);
    });
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const uninstall = installMultiTabStorageListener();
    const handler = listeners.get('storage');
    expect(handler).toBeTypeOf('function');

    handler!(new StorageEvent('storage', {
      key: 'gatesai.chat.v1',
      oldValue: 'old',
      newValue: 'new',
      storageArea: localStorage,
    }));

    expect(warnSpy).toHaveBeenCalledWith(
      'persistence',
      'another browser tab modified localStorage',
      { key: 'gatesai.chat.v1', hadPrevious: true },
    );

    uninstall();
    expect(removeSpy).toHaveBeenCalledWith('storage', handler);
  });

  it('runs provider-config legacy cleanup against the injected backend', () => {
    const storage = memoryStorage({
      'gatesai.providers.v1': JSON.stringify({ openRouterApiKey: 'sk-test' }),
      'gatesai.routing.v1': JSON.stringify({ stale: true }),
    });
    const provider = createProviderConfigsPersistence(storage);

    expect(provider.load()).toEqual({ openrouter: { apiKey: 'sk-test' } });
    expect(storage.getItem('gatesai.routing.v1')).toBeNull();
  });
});

function memoryStorage(initial: Record<string, string> = {}): KeyValuePersistence {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

function quotaStorage(maxChars: number): KeyValuePersistence {
  const storage = memoryStorage();
  return {
    getItem: storage.getItem,
    setItem: (key, value) => {
      if (value.length > maxChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      storage.setItem(key, value);
    },
    removeItem: storage.removeItem,
  };
}

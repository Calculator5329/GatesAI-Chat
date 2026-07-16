import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeSnapshotLoadError,
  flushThreadArchiveSavesForTests,
  flushPendingSnapshot,
  HOT_THREAD_LIMIT,
  loadSnapshot,
  PROACTIVE_HOT_THREAD_LIMIT,
  PROACTIVE_SNAPSHOT_CHARS,
  saveSnapshot,
  scheduleSaveSnapshot,
  setCompactionNoticeHandler,
  setThreadArchiveStoreForTests,
  readThreadArchiveUsage,
} from '../../src/services/persistence';
import { CURRENT_CHAT_SCHEMA_VERSION } from '../../src/services/persistence/migrations';
import { createIndexedDbThreadArchiveStore, type ThreadArchiveStore } from '../../src/services/persistence/idb';
import type { ChatSnapshot, Thread } from '../../src/core/types';
import { logger } from '../../src/services/diagnostics/logger';
import { messageText, messageToolCalls, messageToolResults } from '../../src/core/messageParts';
import { clearAppStorage } from '../helpers/storage';

describe('persistence', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    vi.restoreAllMocks();
    setThreadArchiveStoreForTests(undefined);
    clearAppStorage();
  });

  it('documents last-write-wins when two independent writers save without coordination', () => {
    const snapshotA = {
      threads: [{
        id: 't1', title: 'Alpha only', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 1, updatedAt: 2,
        messages: [{ id: 'm1', role: 'user' as const, content: 'alpha', createdAt: 3 }],
      }],
      activeThreadId: 't1',
    };
    const snapshotB = {
      threads: [{
        id: 't2', title: 'Beta only', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 4, updatedAt: 5,
        messages: [{ id: 'm2', role: 'user' as const, content: 'beta', createdAt: 6 }],
      }],
      activeThreadId: 't2',
    };

    saveSnapshot(snapshotA);
    saveSnapshot(snapshotB);
    saveSnapshot(snapshotA);

    const loaded = loadSnapshot();
    expect(loaded?.threads[0].title).toBe('Alpha only');
    expect(loaded?.threads).toHaveLength(1);
  });

  it('returns null when nothing is stored', () => {
    expect(loadSnapshot()).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const snapshot = {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
      threads: [{
        id: 't1', title: 'hi', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini',
        skillId: 'code-reviewer',
        createdAt: 1, updatedAt: 2,
        messages: [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'yo' }], createdAt: 3 }],
      }],
      activeThreadId: 't1',
    };
    saveSnapshot(snapshot);
    expect(loadSnapshot()).toMatchObject(snapshot);
  });

  it('round-trips assistant message usage records', () => {
    const snapshot = {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
      threads: [{
        id: 't1', title: 'usage', subtitle: '', pinned: false,
        modelId: 'or-gemini-3-flash',
        createdAt: 1, updatedAt: 2,
        messages: [{
          id: 'a1',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'done' }],
          createdAt: 3,
          model: 'or-gemini-3-flash',
          usage: [{
            providerId: 'openrouter' as const,
            modelId: 'google/gemini-3-flash',
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            costUsd: 0.0042,
            costSource: 'provider' as const,
          }],
        }],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    expect(loadSnapshot()).toMatchObject(snapshot);
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem('gatesai.state.v1', '{not json');
    expect(loadSnapshot()).toBeNull();
  });

  it('returns null when threads is not an array', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({ threads: 'nope' }));
    expect(loadSnapshot()).toBeNull();
  });

  it('backs up future-version snapshots and starts fresh with a visible warning', () => {
    const future = {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION + 10,
      threads: [{
        id: 'future-thread',
        title: 'future',
        subtitle: '',
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
      }],
      activeThreadId: 'future-thread',
    };
    const raw = JSON.stringify(future);
    localStorage.setItem('gatesai.state.v1', raw);

    expect(loadSnapshot()).toBeNull();

    const backupKey = Object.keys(localStorage).find(key => key.startsWith('gatesai.state.backup.'));
    expect(backupKey).toBeTruthy();
    expect(localStorage.getItem(backupKey!)).toBe(raw);
    expect(localStorage.getItem('gatesai.state.v1')).toBe(raw);
    expect(consumeSnapshotLoadError()).toMatch(/newer version|backup copy/i);
  });

  it('migrates legacy role:"tool" messages and folds same-turn assistant rounds into one', () => {
    // Snapshot shape we shipped while tool results were their own row AND
    // each model→tool round trip was its own assistant message.
    // Migration should produce ONE assistant message per turn with both
    // calls/results accumulated and the final round's prose as content.
    const legacy = {
      threads: [{
        id: 't1', title: 'memory chat', subtitle: '', pinned: false,
        modelId: 'claude-sonnet-4.5', createdAt: 1, updatedAt: 5,
        messages: [
          { id: 'u1', role: 'user', content: 'remember jazz', createdAt: 1 },
          {
            id: 'a1', role: 'assistant', content: '', createdAt: 2,
            model: 'claude-sonnet-4.5',
            toolCalls: [{ id: 'call_1', name: 'memory', arguments: { action: 'add', fact: 'jazz' } }],
            usage: [{ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', promptTokens: 50, completionTokens: 10, totalTokens: 60, costUsd: 0.002 }],
          },
          {
            id: 'tool_1', role: 'tool', content: 'Saved.', createdAt: 3,
            toolCallId: 'call_1', toolName: 'memory',
          },
          {
            id: 'a2', role: 'assistant', content: 'done — saved.', createdAt: 4,
            usage: [{ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', promptTokens: 20, completionTokens: 5, totalTokens: 25, costUsd: 0.001 }],
          },
        ],
      }],
      activeThreadId: 't1',
    };
    localStorage.setItem('gatesai.state.v1', JSON.stringify(legacy));

    const loaded = loadSnapshot();
    expect(loaded).not.toBeNull();
    const msgs = loaded!.threads[0].messages;
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(loaded!.threads[0].modelId).toBe('or-nemotron-3-ultra-free');
    const a = msgs[1];
    if (a.role !== 'assistant') throw new Error('expected assistant');
    // Identity comes from the first round's message (so external refs survive).
    expect(a.id).toBe('a1');
    expect(messageToolCalls(a)).toHaveLength(1);
    expect(messageToolCalls(a)[0].id).toBe('call_1');
    expect(messageToolResults(a)).toHaveLength(1);
    expect(messageToolResults(a)[0].content).toBe('Saved.');
    expect(a.usage).toHaveLength(2);
    expect(a.usage?.map(usage => usage.totalTokens)).toEqual([60, 25]);
    // Final round's prose wins.
    expect(messageText(a)).toBe('done — saved.');
  });

  it('preserves dynamic OpenRouter and Ollama model ids across migration', () => {
    const snapshot = {
      threads: [
        {
          id: 'or-dynamic', title: 'OpenRouter dynamic', subtitle: '', pinned: false,
          modelId: 'or-live-google_gemini-3-flash-preview',
          createdAt: 1, updatedAt: 2,
          messages: [],
        },
        {
          id: 'ollama-dynamic', title: 'Ollama dynamic', subtitle: '', pinned: false,
          modelId: 'ollama-llama3.2:latest',
          createdAt: 1, updatedAt: 2,
          messages: [],
        },
      ],
      activeThreadId: 'or-dynamic',
    };
    localStorage.setItem('gatesai.state.v1', JSON.stringify(snapshot));

    const loaded = loadSnapshot();

    expect(loaded?.threads.map(thread => thread.modelId)).toEqual([
      'or-live-google_gemini-3-flash-preview',
      'ollama-llama3.2:latest',
    ]);
  });

  it('migration is idempotent on already-clean snapshots', () => {
    const clean = {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
      threads: [{
        id: 't1', title: 'x', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }], createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, createdAt: 2,
            parts: [
              {
                type: 'tool' as const,
                call: { id: 'c1', name: 'memory', arguments: {} },
                result: { toolCallId: 'c1', toolName: 'memory', content: 'ok', ranAt: 3 },
              },
              { type: 'text' as const, text: 'hello' },
            ],
          },
        ],
      }],
      activeThreadId: 't1',
    };
    saveSnapshot(clean);
    expect(loadSnapshot()).toMatchObject(clean);
  });

  it('normalizes legacy thinking effort values into the three visible presets', () => {
    const snapshot = {
      threads: [
        {
          id: 't-none', title: 'none', subtitle: '', pinned: false,
          modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
          thinkingEffort: 'none',
          messages: [],
        },
        {
          id: 't-xhigh', title: 'xhigh', subtitle: '', pinned: false,
          modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
          thinkingEffort: 'xhigh',
          messages: [],
        },
      ],
      activeThreadId: 't-none',
    };
    localStorage.setItem('gatesai.state.v1', JSON.stringify(snapshot));

    const loaded = loadSnapshot();

    expect(loaded?.schemaVersion).toBe(CURRENT_CHAT_SCHEMA_VERSION);
    expect(loaded?.threads.map(thread => thread.thinkingEffort)).toEqual(['low', 'high']);
  });

  it('notifies listeners when an emergency compaction save succeeds', () => {
    const notices: string[] = [];
    setCompactionNoticeHandler(message => { notices.push(message); });
    mockChatStorageQuota(2_000);

    const snapshot = {
      threads: [{
        id: 't1', title: 'compaction notice', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [{
          id: 'a1', role: 'assistant' as const, content: 'done', createdAt: 3,
          toolResults: [{
            toolCallId: 'c1',
            toolName: 'fs',
            content: 'x'.repeat(20_000),
            ranAt: 4,
          }],
        }],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/compacted/i);
    setCompactionNoticeHandler(null);
  });

  it('keeps conversation messages saved when oversized tool results exceed localStorage quota', () => {
    mockChatStorageQuota(2_000);

    const snapshot = {
      threads: [{
        id: 't1', title: 'migration work', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, content: 'convert this csv for migration', createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, content: 'I wrote the structured JSON artifact.',
            createdAt: 2,
            toolCalls: [{ id: 'c1', name: 'fs', arguments: { action: 'read', path: '/workspace/artifacts/huge.json' } }],
            toolResults: [{
              toolCallId: 'c1',
              toolName: 'fs',
              content: 'path: /workspace/artifacts/huge.json\n' + 'x'.repeat(20_000),
              ranAt: 3,
            }],
          },
        ],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    const loaded = loadSnapshot();
    expect(loaded?.threads[0].messages).toHaveLength(2);
    const assistant = loaded?.threads[0].messages[1];
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role !== 'assistant') throw new Error('expected assistant');
    expect(messageText(assistant)).toBe('I wrote the structured JSON artifact.');
    expect(messageToolResults(assistant)[0].content).toContain('[persisted tool result compacted]');
    expect(messageToolResults(assistant)[0].content).toContain('/workspace/artifacts/huge.json');
  });

  it('keeps conversation messages saved when oversized tool call arguments exceed localStorage quota', () => {
    mockChatStorageQuota(2_000);

    const snapshot = {
      threads: [{
        id: 't1', title: 'artifact write', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, content: 'write the migration json', createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, content: 'I wrote the artifact.',
            createdAt: 2,
            toolCalls: [{
              id: 'c1',
              name: 'fs',
              arguments: {
                action: 'write',
                path: '/workspace/artifacts/migration.json',
                content: '{"rows":[' + '1,'.repeat(20_000) + ']}',
              },
            }],
            toolResults: [{
              toolCallId: 'c1',
              toolName: 'fs',
              content: 'Wrote 40010 bytes to /workspace/artifacts/migration.json',
              ranAt: 3,
            }],
          },
        ],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    const loaded = loadSnapshot();
    expect(loaded?.threads[0].messages).toHaveLength(2);
    const assistant = loaded?.threads[0].messages[1];
    if (assistant?.role !== 'assistant') throw new Error('expected assistant');
    expect(messageText(assistant)).toBe('I wrote the artifact.');
    expect(messageToolCalls(assistant)[0].arguments.content).toContain('[persisted tool argument compacted]');
    expect(messageToolCalls(assistant)[0].arguments.content).toContain('/workspace/artifacts/migration.json');
    expect(messageToolResults(assistant)[0].content).toContain('Wrote 40010 bytes');
  });

  it('archives older threads as stubs and swaps a touched archived thread back into the hot tier', async () => {
    const archive = memoryThreadArchiveStore();
    setThreadArchiveStoreForTests(archive);
    const snapshot = snapshotWithThreads(25);

    saveSnapshot(snapshot);
    await flushThreadArchiveSavesForTests();

    let stored = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(stored.threads.filter(thread => !thread.archived)).toHaveLength(HOT_THREAD_LIMIT);
    expect(stored.threads.filter(thread => thread.archived)).toHaveLength(5);
    expect(stored.threads.slice(0, 5).map(thread => [thread.id, thread.archived, thread.messages.length])).toEqual([
      ['t1', true, 0],
      ['t2', true, 0],
      ['t3', true, 0],
      ['t4', true, 0],
      ['t5', true, 0],
    ]);
    expect(stored.threads.find(thread => thread.id === 't1')?.skillId).toBe('code-reviewer');
    expect(archive.threads.get('t1')?.messages).toHaveLength(1);

    const touched = {
      ...stored,
      threads: stored.threads.map(thread =>
        thread.id === 't1'
          ? { ...archive.threads.get('t1')!, updatedAt: 30 }
          : thread
      ),
    };
    saveSnapshot(touched);
    await flushThreadArchiveSavesForTests();

    stored = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(stored.threads.find(thread => thread.id === 't1')?.archived).not.toBe(true);
    expect(stored.threads.find(thread => thread.id === 't1')?.updatedAt).toBe(30);
    expect(stored.threads.find(thread => thread.id === 't1')?.messages).toHaveLength(1);
    expect(stored.threads.find(thread => thread.id === 't6')).toMatchObject({ archived: true });
  });

  it('reports read-only archived-thread entry and byte totals', async () => {
    const archive = memoryThreadArchiveStore();
    setThreadArchiveStoreForTests(archive);
    await archive.putThread(snapshotWithThreads(1).threads[0]);
    await archive.putThread(snapshotWithThreads(2).threads[1]);

    const usage = await readThreadArchiveUsage();

    expect(usage?.entries).toBe(2);
    expect(usage?.bytes).toBeGreaterThan(100);
    expect(usage?.truncated).toBe(false);
    expect(archive.threads.size).toBe(2);
  });

  it('reads archive stats through an existing IndexedDB cursor without writes', async () => {
    const fake = fakeIndexedDbUsage([{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }]);
    const store = createIndexedDbThreadArchiveStore(fake.factory);

    await expect(store.usage()).resolves.toMatchObject({ entries: 2, truncated: false });
    expect(fake.state.transactionModes).toEqual(['readonly']);
    expect(fake.state.closed).toBe(true);
    expect(fake.state.upgradeAborted).toBe(false);
  });

  it('bounds archive scans at 500 records and marks totals as truncated', async () => {
    const values = Array.from({ length: 501 }, (_, index) => ({ id: `thread-${index}`, title: 'Archived' }));
    const fake = fakeIndexedDbUsage(values);
    const store = createIndexedDbThreadArchiveStore(fake.factory);

    const usage = await store.usage();

    expect(usage).toMatchObject({ entries: 500, truncated: true });
    expect(usage.bytes).toBeGreaterThan(0);
    expect(fake.state.transactionModes).toEqual(['readonly']);
  });

  it('aborts a fresh IndexedDB upgrade so stats cannot create storage', async () => {
    const fake = fakeIndexedDbUsage([], { missing: true });
    const store = createIndexedDbThreadArchiveStore(fake.factory);

    await expect(store.usage()).rejects.toThrow('archive does not exist');
    expect(fake.state.upgradeAborted).toBe(true);
    expect(fake.state.transactionModes).toEqual([]);
  });

  it('rejects malformed archive values instead of leaving stats pending', async () => {
    const fake = fakeIndexedDbUsage([{ id: 'bad', value: 1n }]);
    const store = createIndexedDbThreadArchiveStore(fake.factory);

    await expect(store.usage()).rejects.toThrow(/BigInt|serialize/i);
    expect(fake.state.closed).toBe(true);
  });

  it('falls back to the single localStorage snapshot when the archive store is unavailable', async () => {
    setThreadArchiveStoreForTests(null);

    saveSnapshot(snapshotWithThreads(25));
    await flushThreadArchiveSavesForTests();

    const stored = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(stored.threads).toHaveLength(25);
    expect(stored.threads.every(thread => thread.archived !== true && thread.messages.length === 1)).toBe(true);
  });

  it('keeps a thread fully in localStorage when its archive write fails', async () => {
    const archive = memoryThreadArchiveStore({ failPutFor: new Set(['t1']) });
    setThreadArchiveStoreForTests(archive);

    saveSnapshot(snapshotWithThreads(25));
    await flushThreadArchiveSavesForTests();

    const stored = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(stored.threads.find(thread => thread.id === 't1')?.archived).not.toBe(true);
    expect(stored.threads.find(thread => thread.id === 't1')?.messages).toHaveLength(1);
    expect(archive.threads.has('t1')).toBe(false);
  });

  it('archives more aggressively when the localStorage snapshot exceeds the proactive quota estimate', async () => {
    const archive = memoryThreadArchiveStore();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    setThreadArchiveStoreForTests(archive);

    saveSnapshot(snapshotWithThreads(25, { contentChars: Math.ceil(PROACTIVE_SNAPSHOT_CHARS / 20) }));
    await flushThreadArchiveSavesForTests();

    const stored = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(stored.threads.filter(thread => !thread.archived)).toHaveLength(PROACTIVE_HOT_THREAD_LIMIT);
    expect(stored.threads.filter(thread => thread.archived)).toHaveLength(25 - PROACTIVE_HOT_THREAD_LIMIT);
    expect(warnSpy).toHaveBeenCalledWith(
      'persistence',
      'chat snapshot exceeded proactive archive threshold; using smaller hot tier',
      expect.objectContaining({ hotThreadLimit: PROACTIVE_HOT_THREAD_LIMIT }),
    );
  });

  describe('scheduleSaveSnapshot', () => {
    const mkSnap = (title: string) => ({
      threads: [{
        id: 't1', title, subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 1, updatedAt: 2,
        messages: [{ id: 'm1', role: 'user' as const, content: 'yo', createdAt: 3 }],
      }],
      activeThreadId: 't1',
    });

    it('defers the write until a microtask runs', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      scheduleSaveSnapshot(mkSnap('A'));
      expect(setItemSpy).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(loadSnapshot()?.threads[0].title).toBe('A');
    });

    it('coalesces multiple queued saves and writes only the LATEST snapshot', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      scheduleSaveSnapshot(mkSnap('A'));
      scheduleSaveSnapshot(mkSnap('B'));
      scheduleSaveSnapshot(mkSnap('C'));
      await Promise.resolve();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(loadSnapshot()?.threads[0].title).toBe('C');
    });

    it('does not stale-write A on top of a later B (ordering preserved)', async () => {
      // Queue A, let microtask drain (A persists). Queue B. The pending-save
      // flag must reset so B fires its own microtask and lands LAST.
      scheduleSaveSnapshot(mkSnap('A'));
      await Promise.resolve();
      expect(loadSnapshot()?.threads[0].title).toBe('A');
      scheduleSaveSnapshot(mkSnap('B'));
      await Promise.resolve();
      expect(loadSnapshot()?.threads[0].title).toBe('B');
    });

    it('flushPendingSnapshot writes synchronously', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      scheduleSaveSnapshot(mkSnap('Z'));
      expect(setItemSpy).not.toHaveBeenCalled();
      flushPendingSnapshot();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(loadSnapshot()?.threads[0].title).toBe('Z');
    });

    it('flushPendingSnapshot is a no-op when nothing is queued', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      flushPendingSnapshot();
      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });
});

function mockChatStorageQuota(maxChars: number): void {
  const originalSetItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItemWithQuota(this: Storage, key, value) {
    if (key === 'gatesai.state.v1' && value.length > maxChars) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function snapshotWithThreads(count: number, options: { contentChars?: number } = {}): ChatSnapshot {
  return {
    schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
    threads: Array.from({ length: count }, (_, index): Thread => {
      const n = index + 1;
      return {
        id: `t${n}`,
        title: `Thread ${n}`,
        subtitle: '',
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        skillId: n === 1 ? 'code-reviewer' : undefined,
        createdAt: n,
        updatedAt: n,
        messages: [{
          id: `m${n}`,
          role: 'user',
          content: options.contentChars ? `${n}:` + 'x'.repeat(options.contentChars) : `message ${n}`,
          createdAt: n,
        }],
      };
    }),
    activeThreadId: `t${count}`,
  };
}

function memoryThreadArchiveStore(
  options: { failPutFor?: Set<string> } = {},
): ThreadArchiveStore & { threads: Map<string, Thread> } {
  const threads = new Map<string, Thread>();
  return {
    threads,
    async getThread(id: string): Promise<Thread | null> {
      return threads.get(id) ?? null;
    },
    async usage(): Promise<{ entries: number; bytes: number; truncated: boolean }> {
      return {
        entries: threads.size,
        bytes: [...threads.values()].reduce((total, thread) => total + new TextEncoder().encode(JSON.stringify(thread)).byteLength, 0),
        truncated: false,
      };
    },
    async putThread(thread: Thread): Promise<void> {
      if (options.failPutFor?.has(thread.id)) throw new Error(`failed put ${thread.id}`);
      threads.set(thread.id, JSON.parse(JSON.stringify(thread)) as Thread);
    },
    async deleteThread(id: string): Promise<void> {
      threads.delete(id);
    },
  };
}

function fakeIndexedDbUsage(
  values: unknown[],
  options: { missing?: boolean } = {},
): {
  factory: IDBFactory;
  state: { upgradeAborted: boolean; closed: boolean; transactionModes: string[] };
} {
  const state = { upgradeAborted: false, closed: false, transactionModes: [] as string[] };
  const database = {
    close(): void { state.closed = true; },
    transaction(_store: string, mode: IDBTransactionMode) {
      state.transactionModes.push(mode);
      return {
        objectStore: () => ({
          openCursor: () => {
            const cursorRequest = { result: null, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest<IDBCursorWithValue | null>;
            let index = 0;
            const emit = (): void => {
              const cursor = index < values.length
                ? {
                    value: values[index],
                    continue: () => { index += 1; queueMicrotask(emit); },
                  }
                : null;
              Object.assign(cursorRequest, { result: cursor });
              cursorRequest.onsuccess?.(new Event('success'));
            };
            queueMicrotask(emit);
            return cursorRequest;
          },
        }),
      };
    },
  } as unknown as IDBDatabase;
  const factory = {
    open: () => {
      const request = {
        result: database,
        error: null,
        transaction: {
          abort: () => {
            state.upgradeAborted = true;
            Object.assign(request, { error: new Error('IndexedDB archive does not exist.') });
          },
        },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (options.missing) {
          request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
          request.onerror?.(new Event('error'));
        } else {
          request.onsuccess?.(new Event('success'));
        }
      });
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, state };
}

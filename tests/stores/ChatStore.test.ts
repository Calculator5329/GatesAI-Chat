import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore, PROVIDER_STREAM_INITIAL_STALL_MS, PROVIDER_STREAM_STALL_MS } from '../../src/stores/ChatStore';
import { threadLlmSpendUsd } from '../../src/core/threadSelectors';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { LlmChunk, LlmProvider, LlmRequest, ProviderId } from '../../src/core/llm';
import type { ChatSnapshot, Thread } from '../../src/core/types';
import type { LlmRouter } from '../../src/services/llm/router';
import type { BridgeClientFacade, ToolContext } from '../../src/services/tools/types';
import { MockProvider, flush, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';
import { toolRegistry } from '../../src/services/tools/registry';
import { WORKSPACE_CHAT_STATE_PATH } from '../../src/services/workspaceChatPersistence';
import {
  CHAT_SNAPSHOT_STORAGE_KEY,
  flushPendingSnapshot,
  loadSnapshot,
  setThreadArchiveStoreForTests,
} from '../../src/services/persistence';
import type { ThreadArchiveStore } from '../../src/services/persistence/idb';
import { installMultiTabStorageListener } from '../../src/services/storage/persistenceProvider';
import { WebLocksLeaderElection, type WebLockRequestOptions, type WebLocksApi } from '../../src/services/storage/webLocksLeaderElection';
import { messageAttachments, messageText, messageToolCalls, messageToolResults } from '../../src/core/messageParts';
import { UndoService } from '../../src/services/undo/UndoService';

const activeChats: ChatStore[] = [];

function trackChat(chat: ChatStore): ChatStore {
  activeChats.push(chat);
  return chat;
}

function disposeActiveChats(): void {
  while (activeChats.length > 0) {
    activeChats.pop()?.dispose();
  }
}

function setup(chunks?: Parameters<MockProvider['setChunks']>[0]) {
  disposeActiveChats();
  flushPendingSnapshot();
  clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const mock = new MockProvider(chunks);
  installMockProvider(providers, mock);
  const undo = new UndoService();
  const chat = trackChat(new ChatStore(providers, registry, profile, undefined, null, undo));
  return { registry, providers, profile, mock, chat, undo };
}

function onlineBridge(): ToolContext['bridge'] {
  return {
    isOnline: true,
    client: {
      request: async (op: string) => {
        throw new Error(`unexpected bridge op ${op}`);
      },
    },
  } as unknown as ToolContext['bridge'];
}

function chatSnapshot(id: string, title: string) {
  return {
    activeThreadId: id,
    threads: [{
      id,
      title,
      subtitle: '',
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      modelId: 'or-gpt-5.4-mini',
      messages: [{ id: `${id}-m1`, role: 'user' as const, content: title, createdAt: 3 }],
    }],
  };
}

class MockWebLocks implements WebLocksApi {
  private held = false;
  private readonly queue: Array<{
    options: WebLockRequestOptions;
    callback: (lock: unknown) => Promise<void> | void;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  request(_: string, options: WebLockRequestOptions, callback: (lock: unknown) => Promise<void> | void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = { options, callback, resolve, reject };
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(request);
        if (index >= 0) {
          this.queue.splice(index, 1);
          reject(new DOMException('aborted', 'AbortError'));
        }
      }, { once: true });
      this.queue.push(request);
      this.grantNext();
    });
  }

  private grantNext(): void {
    if (this.held || this.queue.length === 0) return;
    const request = this.queue.shift()!;
    this.held = true;
    void Promise.resolve(request.callback({})).then(() => {
      this.held = false;
      request.resolve(undefined);
      this.grantNext();
    }, request.reject);
  }
}

async function settleWebLock(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function archivedThreadPair(id = 'archived-thread'): { stub: Thread; full: Thread } {
  const full: Thread = {
    id,
    title: 'Archived conversation',
    subtitle: '',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    modelId: 'or-gpt-5.4-mini',
    messages: [{ id: 'm-archived', role: 'user', content: 'old message', createdAt: 1 }],
  };
  return {
    full,
    stub: {
      ...full,
      messages: [],
      archived: true,
    },
  };
}

function deferredThreadArchiveStore(): ThreadArchiveStore & {
  resolveGet(thread: Thread | null): void;
  threads: Map<string, Thread>;
} {
  const threads = new Map<string, Thread>();
  let resolveGet: ((thread: Thread | null) => void) | null = null;
  return {
    threads,
    resolveGet(thread: Thread | null): void {
      resolveGet?.(thread);
      resolveGet = null;
    },
    async getThread(): Promise<Thread | null> {
      return new Promise(resolve => { resolveGet = resolve; });
    },
    async putThread(thread: Thread): Promise<void> {
      threads.set(thread.id, thread);
    },
    async deleteThread(id: string): Promise<void> {
      threads.delete(id);
    },
  };
}

function memoryThreadArchiveStore(initial: Record<string, Thread>): ThreadArchiveStore {
  const threads = new Map(Object.entries(initial));
  return {
    async getThread(id: string): Promise<Thread | null> {
      return threads.get(id) ?? null;
    },
    async putThread(thread: Thread): Promise<void> {
      threads.set(thread.id, thread);
    },
    async deleteThread(id: string): Promise<void> {
      threads.delete(id);
    },
  };
}

function memoryBridge(initial: Record<string, string> = {}): BridgeClientFacade & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async request<T = unknown>(op: string, data: unknown): Promise<T> {
      const args = data as Record<string, string>;
      switch (op) {
        case 'fs.mkdir':
          return {} as T;
        case 'fs.read': {
          const value = files.get(args.path);
          if (value == null) throw new Error('not found');
          return {
            path: args.path,
            content: value,
            encoding: 'utf8',
            size: value.length,
            mime: 'application/json',
          } as T;
        }
        case 'fs.write':
          files.set(args.path, args.content ?? '');
          return { path: args.path, bytes: (args.content ?? '').length } as T;
        case 'fs.list': {
          const prefix = args.path.replace(/\/+$/, '');
          return {
            path: prefix,
            entries: [...files.keys()]
              .filter(path => path.startsWith(`${prefix}/`))
              .map(path => ({
                path,
                name: path.slice(prefix.length + 1),
                kind: 'file',
                size: files.get(path)?.length ?? 0,
                mtime: 1,
              })),
          } as T;
        }
        case 'fs.delete':
          files.delete(args.path);
          return {} as T;
        case 'fs.move': {
          const value = files.get(args.from);
          if (value == null) throw new Error('not found');
          files.set(args.to, value);
          files.delete(args.from);
          return {} as T;
        }
        default:
          throw new Error(`unexpected op ${op}`);
      }
    },
  };
}

function failingBridge(): BridgeClientFacade {
  return {
    async request<T = unknown>(): Promise<T> {
      throw new Error('workspace unavailable');
    },
  };
}

async function waitForWorkspaceSave(
  bridge: { files: Map<string, string> },
  predicate: (raw: string) => boolean,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const raw = bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '';
    if (predicate(raw)) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('workspace save did not settle');
}

async function waitForLocalStorageTitle(title: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const raw = localStorage.getItem('gatesai.state.v1') ?? '{}';
    const parsed = JSON.parse(raw) as { threads?: Array<{ title?: string }> };
    if (parsed.threads?.[0]?.title === title) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('localStorage save did not settle');
}

async function waitForLocalStorageSnapshot(
  predicate: (snapshot: ChatSnapshot) => boolean,
  label: string,
): Promise<ChatSnapshot> {
  for (let i = 0; i < 50; i++) {
    flushPendingSnapshot();
    const raw = localStorage.getItem('gatesai.state.v1') ?? '{}';
    const parsed = JSON.parse(raw) as ChatSnapshot;
    if (predicate(parsed)) return parsed;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`localStorage save did not settle: ${label}`);
}

describe('ChatStore', () => {
  beforeEach(() => {
    disposeActiveChats();
    setThreadArchiveStoreForTests(undefined);
    flushPendingSnapshot();
    clearAppStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
    disposeActiveChats();
    setThreadArchiveStoreForTests(undefined);
    flushPendingSnapshot();
    clearAppStorage();
  });

  it('creates exactly one empty untitled thread when no snapshot exists', () => {
    const { chat } = setup();
    expect(chat.threads).toHaveLength(1);
    expect(chat.threads[0].messages).toEqual([]);
    expect(chat.threads[0].title).toBe('New conversation');
    expect(chat.activeThreadId).toBe(chat.threads[0].id);
  });

  it('hydrates an archived active thread from the archive store', async () => {
    const { stub, full } = archivedThreadPair();
    setThreadArchiveStoreForTests(memoryThreadArchiveStore({ [full.id]: full }));
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      schemaVersion: 2,
      threads: [stub],
      activeThreadId: stub.id,
    }));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const mock = new MockProvider();
    installMockProvider(providers, mock);

    const chat = trackChat(new ChatStore(providers, registry, profile));

    expect(chat.activeThread?.archived).toBe(true);
    expect(chat.activeThreadHydrating).toBe(true);
    await flush();
    expect(chat.activeThread?.archived).not.toBe(true);
    expect(chat.activeThread?.messages.map(messageText)).toEqual(['old message']);
    expect(chat.activeThreadHydrating).toBe(false);
  });

  it('waits for archived-thread hydration before sending a message', async () => {
    const { stub, full } = archivedThreadPair();
    const archive = deferredThreadArchiveStore();
    setThreadArchiveStoreForTests(archive);
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      schemaVersion: 2,
      threads: [stub],
      activeThreadId: stub.id,
    }));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const mock = new MockProvider([{ type: 'text', delta: 'hydrated reply' }, { type: 'done', finishReason: 'stop' }]);
    installMockProvider(providers, mock);
    const chat = trackChat(new ChatStore(providers, registry, profile));

    chat.sendMessage('new message');

    expect(chat.activeThread?.messages).toEqual([]);
    expect(mock.calls).toHaveLength(0);

    archive.resolveGet(full);
    await flush(10);

    expect(chat.activeThread?.messages.map(messageText)).toContain('old message');
    expect(chat.activeThread?.messages.map(messageText)).toContain('new message');
    expect(mock.calls).toHaveLength(1);
  });

  it('surfaces a future-version snapshot warning as a persistence notice', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      schemaVersion: 999,
      threads: [{
        id: 'future',
        title: 'Future',
        subtitle: '',
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        messages: [],
      }],
      activeThreadId: 'future',
    }));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    installMockProvider(providers, new MockProvider());

    const chat = trackChat(new ChatStore(providers, registry, profile));

    expect(chat.threads).toHaveLength(1);
    expect(chat.threads[0].title).toBe('New conversation');
    expect(chat.compactionNotice).toMatch(/newer version|backup copy/i);
    expect(Object.keys(localStorage).some(key => key.startsWith('gatesai.state.backup.'))).toBe(true);
  });

  it('derives one ambient activity list from thinking notes and tool state', () => {
    const { chat } = setup();
    const assistant = {
      id: 'm-activity',
      role: 'assistant' as const,
      createdAt: 1000,
      content: '',
      preTokenLabel: 'thinking' as const,
      workNotes: ['I will inspect the file first.'],
      toolCalls: [
        { id: 'tc-1', name: 'fs', arguments: { action: 'read', path: '/workspace/notes/plan.md' } },
        { id: 'tc-2', name: 'web_search', arguments: { queries: ['React 19 release notes'] } },
      ],
      toolResults: [{
        toolCallId: 'tc-1',
        toolName: 'fs',
        content: 'status: ok\ntool: fs\nsummary: Read plan.md',
        summary: 'Read plan.md',
        ok: true,
        ranAt: 1200,
      }],
    };

    const activities = chat.activitiesForMessage(assistant, { streaming: true });

    expect(activities.map(item => [item.kind, item.state, item.verb, item.target])).toEqual([
      ['thinking', 'done', 'Thinking', undefined],
      ['tool', 'done', 'Reading', 'plan.md'],
      ['tool', 'running', 'Searching', 'React 19 release notes'],
      ['thinking', 'running', 'Thinking', undefined],
    ]);
    expect(activities[0].detail?.content).toContain('inspect the file');
    expect(activities[1].summary).toBe('Read plan.md');
    expect(activities[1].groupKey).toBe('tool:fs');
    expect(activities[2].groupKey).toBe('tool:web_search');
  });

  it('tags consecutive same-tool calls with a shared groupKey for collapsing', () => {
    const { chat } = setup();
    const assistant = {
      id: 'm-group-key',
      role: 'assistant' as const,
      createdAt: 1000,
      content: '',
      toolCalls: [
        { id: 'tc-a', name: 'fs', arguments: { action: 'read', path: '/workspace/a.md' } },
        { id: 'tc-b', name: 'fs', arguments: { action: 'read', path: '/workspace/b.md' } },
      ],
      toolResults: [
        { toolCallId: 'tc-a', toolName: 'fs', content: 'status: ok\ntool: fs\nsummary: Read a.md', summary: 'Read a.md', ok: true, ranAt: 1200 },
        { toolCallId: 'tc-b', toolName: 'fs', content: 'status: ok\ntool: fs\nsummary: Read b.md', summary: 'Read b.md', ok: true, ranAt: 1300 },
      ],
    };

    const activities = chat.activitiesForMessage(assistant);

    expect(activities).toHaveLength(2);
    expect(activities[0].groupKey).toBe('tool:fs');
    expect(activities[1].groupKey).toBe('tool:fs');
  });

  it('attaches live terminal tail only to the matching terminal tool call', () => {
    const { chat } = setup();
    const thread = chat.activeThread!;
    const assistant = {
      id: 'm-terminal-tail',
      role: 'assistant' as const,
      createdAt: 1000,
      content: '',
      toolCalls: [
        { id: 'tc-terminal', name: 'terminal', arguments: { cmd: 'npm', args: ['run', 'test'] } },
      ],
    };
    runInAction(() => {
      thread.messages.push(assistant);
    });
    chat.setToolStoresProvider(() => ({
      execStream: {
        jobs: {
          wrong: {
            id: 'wrong',
            threadId: 'other-thread',
            toolCallId: 'tc-terminal',
            cmd: 'npm',
            args: ['run', 'test'],
            startedAt: 2000,
            status: 'running',
            tail: [{ stream: 'stdout', text: 'wrong tail' }],
          },
          right: {
            id: 'right',
            threadId: thread.id,
            toolCallId: 'tc-terminal',
            cmd: 'npm',
            args: ['run', 'test'],
            startedAt: 1000,
            status: 'running',
            tail: [{ stream: 'stdout', text: 'right tail' }],
          },
        },
      },
    }) as never);

    const activities = chat.activitiesForMessage(assistant, { streaming: true });

    expect(activities[0].detail?.type).toBe('terminal');
    expect(activities[0].detail?.lines?.map(line => line.text)).toEqual(['right tail']);
  });

  it('attaches bridge transition activity to the active streaming assistant turn', () => {
    const { chat } = setup();
    const thread = chat.activeThread!;
    const assistant = {
      id: 'm-bridge-activity',
      role: 'assistant' as const,
      createdAt: 1000,
      content: '',
    };
    runInAction(() => {
      thread.messages.push(assistant);
      chat.streamingByThread[thread.id] = assistant.id;
    });

    chat.recordActivityEvent({
      id: 'bridge-1',
      kind: 'bridge',
      state: 'failed',
      verb: 'Workspace offline',
      summary: 'Health check failed',
      startedAt: 1100,
      finishedAt: 1100,
    });

    const stored = chat.activeThread!.messages.find(message => message.id === assistant.id);
    const activities = chat.activitiesForMessage(stored as typeof assistant, { streaming: true });

    expect(activities.map(item => [item.kind, item.state, item.verb])).toContainEqual(['bridge', 'failed', 'Workspace offline']);
  });

  it('recordActivityEvent attaches to a background streaming thread when active thread differs', () => {
    const { chat } = setup();
    const backgroundId = chat.createThread();
    const background = chat.threads.find(t => t.id === backgroundId)!;
    const assistant = {
      id: 'm-bg-stream',
      role: 'assistant' as const,
      createdAt: 1000,
      content: 'streaming…',
    };
    runInAction(() => {
      background.messages.push(assistant);
      chat.streamingByThread[backgroundId] = assistant.id;
    });
    const activeId = chat.createThread();
    expect(chat.activeThreadId).toBe(activeId);
    expect(chat.isThreadStreaming(backgroundId)).toBe(true);

    chat.recordActivityEvent({
      id: 'bridge-bg',
      kind: 'bridge',
      state: 'running',
      verb: 'Workspace online',
      summary: 'Connected',
      startedAt: 1200,
      finishedAt: 1200,
    });

    const bgMessage = background.messages.find(m => m.id === assistant.id);
    expect(bgMessage?.role === 'assistant' ? bgMessage.activityEvents?.[0]?.verb : undefined).toBe('Workspace online');
    const activeAssistant = chat.activeThread!.messages.find(m => m.role === 'assistant');
    expect(activeAssistant).toBeUndefined();
  });

  it('reloadFromStorage applies a newer snapshot and clears persistence conflict', () => {
    const { chat } = setup();
    const threadId = chat.activeThreadId!;
    chat.renameThread(threadId, 'Stale in memory');
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      activeThreadId: threadId,
      threads: [{
        id: threadId,
        title: 'Fresh from storage',
        subtitle: '',
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        modelId: 'or-gemini-3-flash',
        messages: [{ id: 'm1', role: 'user', content: 'from disk', createdAt: 3 }],
      }],
    }));
    runInAction(() => {
      chat.persistenceConflict = 'tab conflict';
      (chat as unknown as { persistPaused: boolean }).persistPaused = true;
    });

    chat.reloadFromStorage();

    expect(chat.persistenceConflict).toBeNull();
    expect(chat.threads.find(t => t.id === threadId)?.title).toBe('Fresh from storage');
    expect(messageText(chat.activeThread!.messages[0])).toBe('from disk');
  });

  it('reloadFromStorage aborts in-flight streams so abandoned turns stop mutating', async () => {
    // Stream that emits one token then stays pending until aborted — a turn
    // genuinely mid-flight when the cross-tab reload happens.
    class PendingStreamProvider implements LlmProvider {
      readonly id: ProviderId = 'openrouter';
      ready(): boolean { return true; }
      async *stream(_req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
        yield { type: 'text', delta: 'partial' };
        await new Promise<void>((resolve) => {
          if (signal.aborted) { resolve(); return; }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    }

    disposeActiveChats();
    flushPendingSnapshot();
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    installMockProvider(providers, new PendingStreamProvider());
    const chat = trackChat(new ChatStore(providers, registry, profile));

    const threadId = chat.createThread();
    chat.sendMessage('stream please');
    await vi.waitFor(() => expect(chat.isThreadStreaming(threadId)).toBe(true));

    // Another tab cleared storage; reloading must stop the in-flight stream
    // rather than let it keep appending into the freshly-loaded state.
    chat.reloadFromStorage();
    expect(chat.isThreadStreaming(threadId)).toBe(false);
  });

  it('defaults persisted unresolved thread models back to the free Nemotron 3 Ultra route', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      activeThreadId: 't-stale',
      threads: [{
        id: 't-stale',
        title: 'Stale model',
        subtitle: '',
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
        modelId: 'or-live-provider/removed-model',
        messages: [],
      }],
    }));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();

    const chat = new ChatStore(providers, registry, profile);

    expect(chat.activeThread?.modelId).toBe('or-nemotron-3-ultra-free');
  });

  it('repairs a persisted active thread id that no longer points to a visible thread', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      activeThreadId: 'missing',
      threads: [
        {
          id: 'deleted',
          title: 'Deleted',
          subtitle: '',
          createdAt: 1,
          updatedAt: 3,
          pinned: false,
          modelId: 'or-gemini-3-flash',
          messages: [],
          deletedAt: 4,
        },
        {
          id: 'visible',
          title: 'Visible',
          subtitle: '',
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          modelId: 'or-gemini-3-flash',
          messages: [],
        },
      ],
    }));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();

    const chat = new ChatStore(providers, registry, profile);

    expect(chat.activeThreadId).toBe('visible');
  });

  it('uses localStorage at startup, then hydrates from valid workspace history', async () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify(chatSnapshot('local', 'Local history')));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const chat = new ChatStore(providers, registry, profile);
    const bridge = memoryBridge({
      [WORKSPACE_CHAT_STATE_PATH]: JSON.stringify({
        version: 1,
        savedAt: '2026-05-12T00:00:00.000Z',
        source: 'workspace',
        snapshot: chatSnapshot('workspace', 'Workspace history'),
      }),
    });

    expect(chat.activeThread?.title).toBe('Local history');
    await chat.enableWorkspacePersistence(bridge);

    expect(chat.activeThreadId).toBe('workspace');
    expect(chat.activeThread?.title).toBe('Workspace history');
    expect(JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}').activeThreadId).toBe('workspace');
  });

  it('migrates localStorage history into the workspace when workspace state is absent', async () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify(chatSnapshot('local', 'Local only')));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const chat = new ChatStore(providers, registry, profile);
    const bridge = memoryBridge();

    await chat.enableWorkspacePersistence(bridge);

    const envelope = JSON.parse(bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '{}');
    expect(envelope.source).toBe('localStorage-migration');
    expect(envelope.snapshot.activeThreadId).toBe('local');
    expect(envelope.snapshot.threads[0].title).toBe('Local only');
  });

  it('keeps local fallback when workspace history is malformed and writes a backup', async () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify(chatSnapshot('local', 'Local fallback')));
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const chat = new ChatStore(providers, registry, profile);
    const bridge = memoryBridge({ [WORKSPACE_CHAT_STATE_PATH]: '{not json' });

    await chat.enableWorkspacePersistence(bridge);

    expect(chat.activeThread?.title).toBe('Local fallback');
    expect([...bridge.files.keys()].some(path => path.includes('/malformed-'))).toBe(true);
    expect(JSON.parse(bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '{}').snapshot.activeThreadId).toBe('local');
  });

  it('saves subsequent mutations to workspace after workspace persistence is enabled', async () => {
    const { chat } = setup();
    const bridge = memoryBridge();

    await chat.enableWorkspacePersistence(bridge);
    chat.renameThread(chat.activeThreadId!, 'Workspace mutation');
    await waitForWorkspaceSave(bridge, raw => raw.includes('Workspace mutation'));

    const envelope = JSON.parse(bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '{}');
    expect(envelope.snapshot.threads[0].title).toBe('Workspace mutation');
  });

  it('continues saving localStorage when workspace persistence cannot start', async () => {
    const { chat } = setup();
    const bridge = failingBridge();

    expect(await chat.enableWorkspacePersistence(bridge)).toBe(false);
    chat.renameThread(chat.activeThreadId!, 'Local survives');
    await waitForLocalStorageTitle('Local survives');

    expect(JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}').threads[0].title).toBe('Local survives');
  });

  it('persists a freshly sent message + streamed reply with no thread-list change (regression: deep autosave tracking)', async () => {
    // Repro of the bug where a single new conversation was lost on reload:
    // sendMessage appends the user message and streams the reply by mutating
    // existing thread/message objects in place, without any create/select/
    // rename that would reassign the threads array. The autosave reaction must
    // observe those nested edits, not just the top-level threads array.
    const { chat } = setup([
      { type: 'text', delta: 'streamed reply body' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const threadId = chat.activeThreadId!;

    chat.sendMessage('remember me across reload');
    await flush(20);

    const snapshot = await waitForLocalStorageSnapshot(
      s => {
        const t = s.threads.find(thread => thread.id === threadId);
        return !!t
          && t.messages.some(m => messageText(m) === 'remember me across reload')
          && t.messages.some(m => messageText(m).includes('streamed reply body'));
      },
      'sent message + streamed reply persisted to localStorage',
    );

    const thread = snapshot.threads.find(t => t.id === threadId)!;
    expect(thread.messages.some(m => m.role === 'user' && messageText(m) === 'remember me across reload')).toBe(true);
    expect(thread.messages.some(m => m.role === 'assistant' && messageText(m).includes('streamed reply body'))).toBe(true);
  });

  it('persists context mode and thinking effort without a later chat mutation', async () => {
    const { chat } = setup();
    const threadId = chat.activeThreadId!;

    chat.setThreadContextMode(threadId, 'system-tools');
    chat.setThreadThinkingEffort(threadId, 'high');

    const snapshot = await waitForLocalStorageSnapshot(
      s => {
        const thread = s.threads.find(t => t.id === threadId);
        return thread?.contextMode === 'system-tools' && thread.thinkingEffort === 'high';
      },
      'thread settings persisted to localStorage',
    );

    const thread = snapshot.threads.find(t => t.id === threadId)!;
    expect(thread.contextMode).toBe('system-tools');
    expect(thread.thinkingEffort).toBe('high');
  });

  it('repairs a live unresolved active model before sending', () => {
    const { chat } = setup();
    chat.setThreadModel(chat.activeThreadId!, 'missing-model');

    chat.sendMessage('hello');

    expect(chat.activeThread?.modelId).toBe('or-nemotron-3-ultra-free');
  });

  it('passes per-thread thinking effort to model requests', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.setThreadThinkingEffort(chat.activeThreadId!, 'high');

    chat.sendMessage('think about this');
    await flush(20);

    expect(mock.calls[0].thinkingEffort).toBe('high');
  });

  it('defaults OpenRouter requests to low thinking effort', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);

    chat.sendMessage('think about this');
    await flush(20);

    expect(mock.calls[0].thinkingEffort).toBe('low');
  });

  it('does not hard-cap OpenRouter output for tool-capable turns even with high thinking', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.setThreadThinkingEffort(chat.activeThreadId!, 'high');

    chat.sendMessage('Make a cool HTML game');
    await flush(20);

    expect(mock.calls[0].thinkingEffort).toBe('high');
    expect(mock.calls[0].tools?.length).toBeGreaterThan(0);
    expect(mock.calls[0].maxTokens).toBeUndefined();
  });

  it('exposes web_search to model requests only when Brave Search is configured', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.setToolStoresProvider(() => ({
      search: {
        braveReady: true,
        searchBraveContext: async () => [],
      },
    }) as unknown as Pick<ToolContext, 'search'>);

    chat.sendMessage('What changed today?');
    await flush(20);

    expect(mock.calls[0].tools?.some(t => t.name === 'web_search')).toBe(true);

    const withoutSearch = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    withoutSearch.chat.sendMessage('What changed today?');
    await flush(20);

    expect(withoutSearch.mock.calls[0].tools?.some(t => t.name === 'web_search')).toBe(false);
  });

  it('createThread inserts a new thread at the top and selects it', () => {
    const { chat } = setup();
    const before = chat.threads.length;
    const id = chat.createThread();
    expect(chat.threads).toHaveLength(before + 1);
    expect(chat.threads[0].id).toBe(id);
    expect(chat.activeThreadId).toBe(id);
  });

  it('selectThread updates synchronously even when View Transitions are available', () => {
    const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
    const original = doc.startViewTransition;
    doc.startViewTransition = () => ({});
    try {
      const { chat } = setup();
      const first = chat.activeThreadId!;
      const second = chat.createThread();
      expect(chat.activeThreadId).toBe(second);

      chat.selectThread(first);

      expect(chat.activeThreadId).toBe(first);
    } finally {
      if (original) {
        doc.startViewTransition = original;
      } else {
        delete doc.startViewTransition;
      }
    }
  });

  it('selectThread rejects unknown and deleted thread ids', () => {
    const { chat } = setup();
    const original = chat.activeThreadId!;
    const deleted = chat.createThread();
    chat.softDeleteThread(deleted);

    expect(chat.selectThread('missing')).toBe(false);
    expect(chat.activeThreadId).toBe(original);
    expect(chat.selectThread(deleted)).toBe(false);
    expect(chat.activeThreadId).toBe(original);
  });

  it('softDeleteThread hides the thread from visibleThreads but keeps it in storage', () => {
    const { chat } = setup();
    const a = chat.createThread();
    const b = chat.createThread();
    chat.softDeleteThread(b);
    expect(chat.visibleThreads.map(t => t.id)).not.toContain(b);
    expect(chat.threads.map(t => t.id)).toContain(b);
    expect(chat.threads.find(t => t.id === b)?.deletedAt).toBeTypeOf('number');
    expect(chat.activeThreadId).not.toBe(b);
    expect([a, chat.activeThreadId]).toContain(chat.activeThreadId);
  });

  it('softDeleteThread while streaming annotates the partial assistant reply', async () => {
    const slow: Parameters<MockProvider['setChunks']>[0] = [];
    for (let i = 0; i < 50; i++) slow.push({ type: 'text', delta: 'x' });
    slow.push({ type: 'done', finishReason: 'stop' });

    const { chat } = setup(slow);
    const threadId = chat.createThread();
    chat.sendMessage('go');
    await flush(2);
    expect(chat.isThreadStreaming(threadId)).toBe(true);

    chat.softDeleteThread(threadId);
    expect(chat.isThreadStreaming(threadId)).toBe(false);

    const reply = chat.threads.find(t => t.id === threadId)!.messages.find(m => m.role === 'assistant')!;
    expect(messageText(reply)).toContain('[interrupted]');
    expect(chat.threads.find(t => t.id === threadId)?.deletedAt).toBeTypeOf('number');
  });

  it('restoreThread brings a soft-deleted thread back into visibleThreads', () => {
    const { chat } = setup();
    const id = chat.createThread();
    chat.softDeleteThread(id);
    chat.restoreThread(id);
    expect(chat.threads.find(t => t.id === id)?.deletedAt).toBeUndefined();
    expect(chat.visibleThreads.map(t => t.id)).toContain(id);
  });

  it('toggles pinning and trims empty renames to Untitled conversation', () => {
    const { chat } = setup();
    const id = chat.createThread();

    chat.toggleThreadPinned(id);
    chat.renameThread(id, '   ');

    expect(chat.threads.find(t => t.id === id)?.pinned).toBe(true);
    expect(chat.threads.find(t => t.id === id)?.title).toBe('Untitled conversation');

    chat.toggleThreadPinned(id);
    expect(chat.threads.find(t => t.id === id)?.pinned).toBe(false);
  });

  it.each([
    {
      label: 'middle user message',
      targetId: 'u2',
      expected: ['first', 'first answer', 'edited prompt', 'edited answer'],
    },
    {
      label: 'first user message',
      targetId: 'u1',
      expected: ['edited prompt', 'edited answer'],
    },
    {
      label: 'last user message',
      targetId: 'u3',
      expected: ['first', 'first answer', 'second', 'second answer', 'edited prompt', 'edited answer'],
    },
  ])('edit-and-resend truncates after the $label and re-runs in place', async ({ targetId, expected }) => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'edited answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'first answer', createdAt: 2, model: 'or-gemini-3-flash' },
        {
          id: 'u2',
          role: 'user',
          content: 'second',
          createdAt: 3,
          attachments: [{ path: '/workspace/attachments/a.txt', name: 'a.txt', mime: 'text/plain', size: 12 }],
        },
        { id: 'a2', role: 'assistant', content: 'second answer', createdAt: 4, model: 'or-gemini-3-flash' },
        { id: 'u3', role: 'user', content: 'third', createdAt: 5 },
      );
    });

    const resultId = chat.editAndResend(id, targetId, 'edited prompt');
    await flush(20);

    const thread = chat.threads.find(t => t.id === id)!;
    expect(resultId).toBe(id);
    expect(thread.messages.map(messageText)).toEqual(expected);
    const edited = thread.messages.find(m => m.id === targetId);
    expect(edited && messageText(edited)).toBe('edited prompt');
    if (targetId === 'u2') {
      expect(edited?.role === 'user' ? messageAttachments(edited)[0].path : undefined).toBe('/workspace/attachments/a.txt');
    }
    expect(mock.calls).toHaveLength(1);
  });

  it('regenerates an assistant message by removing that message and everything after it', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'replacement answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'first answer', createdAt: 2, model: 'or-gemini-3-flash' },
        { id: 'u2', role: 'user', content: 'second', createdAt: 3 },
        { id: 'a2', role: 'assistant', content: 'old second answer', createdAt: 4, model: 'or-gemini-3-flash' },
        { id: 'u3', role: 'user', content: 'third', createdAt: 5 },
        { id: 'a3', role: 'assistant', content: 'third answer', createdAt: 6, model: 'or-gemini-3-flash' },
      );
    });

    const resultId = chat.regenerate(id, 'a2');
    await flush(20);

    const thread = chat.threads.find(t => t.id === id)!;
    expect(resultId).toBe(id);
    expect(thread.messages.map(messageText)).toEqual(['first', 'first answer', 'second', 'replacement answer']);
    expect(mock.calls).toHaveLength(1);
  });

  it('branches a thread with copied message content, fresh message ids, and durable tool results', () => {
    const { chat } = setup();
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-gpt-5.5');
    chat.setThreadContextMode(id, 'system-tools');
    chat.setThreadThinkingEffort(id, 'high');
    chat.setThreadContext(id, 'source-only context');
    runInAction(() => {
      chat.activeThread!.title = 'Research';
      chat.activeThread!.pinned = true;
      chat.activeThread!.autoNamed = true;
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'one', createdAt: 1 },
        {
          id: 'a1',
          role: 'assistant',
          content: 'two',
          createdAt: 2,
          model: 'or-gpt-5.5',
          preTokenLabel: 'responding',
          toolCalls: [{ id: 'call-1', name: 'fs', arguments: { action: 'read', path: '/workspace/a.txt' } }],
          toolResults: [{ toolCallId: 'call-1', toolName: 'fs', content: 'result', ranAt: 3 }],
          activityEvents: [{ id: 'evt-1', kind: 'bridge', state: 'done', verb: 'Workspace online', startedAt: 4 }],
        },
        { id: 'u2', role: 'user', content: 'three', createdAt: 5 },
      );
    });
    const source = chat.threads.find(t => t.id === id)!;
    const sourceIds = source.messages.map(m => m.id);

    const branchId = chat.branchFrom(id, 'a1');
    const branch = chat.threads.find(t => t.id === branchId);

    expect(branch).toBeDefined();
    expect(branch?.title).toBe('Research (branch)');
    expect(branch?.pinned).toBe(false);
    expect(branch?.autoNamed).toBeUndefined();
    expect(branch?.modelId).toBe('or-gpt-5.5');
    expect(branch?.contextMode).toBe('system-tools');
    expect(branch?.thinkingEffort).toBe('high');
    expect(branch?.threadContext).toBeUndefined();
    expect(branch?.messages.map(messageText)).toEqual(['one', 'two']);
    expect(branch?.messages.map(m => m.id)).not.toEqual(sourceIds.slice(0, 2));
    expect(source.messages.map(messageText)).toEqual(['one', 'two', 'three']);
    const copiedAssistant = branch?.messages[1];
    expect(copiedAssistant?.role === 'assistant' ? messageToolResults(copiedAssistant)[0].content : undefined).toBe('result');
    expect(copiedAssistant?.role === 'assistant' ? copiedAssistant.preTokenLabel : undefined).toBeUndefined();
    expect(copiedAssistant?.role === 'assistant' ? copiedAssistant.activityEvents : undefined).toBeUndefined();
    expect(chat.activeThreadId).toBe(id);
  });

  it('does not edit, regenerate, or branch while the source thread is streaming', () => {
    const { chat } = setup();
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'one', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'streaming', createdAt: 2, model: 'or-gemini-3-flash' },
      );
      (chat as unknown as { streamingByThread: Record<string, string> }).streamingByThread[id] = 'a1';
    });

    expect(chat.editAndResend(id, 'u1', 'edited')).toBeNull();
    expect(chat.regenerate(id, 'a1')).toBeNull();
    expect(chat.branchFrom(id, 'u1')).toBeNull();
    expect(chat.threads).toHaveLength(2);
    expect(chat.activeThread?.messages.map(messageText)).toEqual(['one', 'streaming']);
  });

  it('persists edit-and-resend truncation through the autosave path', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'persisted replacement' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'old prompt', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'old answer', createdAt: 2, model: 'or-gemini-3-flash' },
      );
    });

    chat.editAndResend(id, 'u1', 'persisted prompt');

    const snapshot = await waitForLocalStorageSnapshot(
      s => {
        const thread = s.threads.find(t => t.id === id);
        return !!thread
          && thread.messages.some(m => messageText(m) === 'persisted prompt')
          && thread.messages.some(m => messageText(m) === 'persisted replacement')
          && !thread.messages.some(m => messageText(m) === 'old answer');
      },
      'edit-and-resend mutation persisted to localStorage',
    );

    const thread = snapshot.threads.find(t => t.id === id)!;
    expect(thread.messages.map(messageText)).toEqual(['persisted prompt', 'persisted replacement']);
  });

  it('softDeleteThread on the only remaining thread spawns a fresh empty one', () => {
    const { chat } = setup();
    const only = chat.activeThreadId!;
    chat.softDeleteThread(only);
    expect(chat.visibleThreads).toHaveLength(1);
    expect(chat.visibleThreads[0].id).not.toBe(only);
    expect(chat.activeThreadId).toBe(chat.visibleThreads[0].id);
  });

  it('sendMessage appends user + assistant messages and streams content', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.createThread();

    chat.sendMessage('hi');
    await flush(20);

    const thread = chat.activeThread!;
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].role).toBe('user');
    expect(messageText(thread.messages[0])).toBe('hi');
    expect(thread.messages[1].role).toBe('assistant');
    expect(messageText(thread.messages[1])).toBe('Hello world');
    expect(chat.streamingMessageId).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it('clearAllThreads leaves one fresh active thread', () => {
    const { chat } = setup();
    const old = chat.activeThreadId!;
    chat.createThread();

    chat.clearAllThreads();

    expect(chat.visibleThreads).toHaveLength(1);
    expect(chat.activeThreadId).toBe(chat.visibleThreads[0].id);
    expect(chat.activeThreadId).not.toBe(old);
    expect(chat.activeThread?.messages).toEqual([]);
  });

  it('registers clearAllThreads with the undo stack and restores the prior history', () => {
    const { chat, undo } = setup();
    const first = chat.activeThreadId!;
    const second = chat.createThread();

    chat.clearAllThreads();
    expect(chat.visibleThreads).toHaveLength(1);
    expect(undo.getSnapshot()).toMatchObject({ canUndo: true, nextLabel: 'Delete all threads' });

    expect(undo.undo()).toBe(true);
    expect(chat.visibleThreads.map(thread => thread.id)).toEqual([second, first]);
    expect(chat.activeThreadId).toBe(second);
  });

  it('stores provider-reported OpenRouter usage cost on assistant messages', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'Hello' },
      {
        type: 'usage',
        usage: {
          providerId: 'openrouter',
          modelId: 'google/gemini-3-flash',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costUsd: 0.0042,
        },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.createThread();

    chat.sendMessage('hi');
    await flush(20);

    const assistant = chat.activeThread!.messages.find(m => m.role === 'assistant');
    expect(assistant?.role === 'assistant' ? assistant.usage?.[0].costUsd : undefined).toBe(0.0042);
    expect(assistant?.role === 'assistant' ? assistant.usage?.[0].costSource : undefined).toBe('provider');
    expect(threadLlmSpendUsd(chat.activeThread)).toBe(0.0042);
  });

  it('stores computed OpenRouter usage cost when the provider omits cost', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'Hello' },
      {
        type: 'usage',
        usage: {
          providerId: 'openrouter',
          modelId: 'google/gemini-3-flash',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.createThread();
    chat.setThreadModel(chat.activeThreadId!, 'or-gemini-3-flash');

    chat.sendMessage('hi');
    await flush(20);

    const assistant = chat.activeThread!.messages.find(m => m.role === 'assistant');
    const usage = assistant?.role === 'assistant' ? assistant.usage?.[0] : undefined;
    expect(usage?.costUsd).toBeCloseTo(0.00008);
    expect(usage?.costSource).toBe('pricing');
    expect(threadLlmSpendUsd(chat.activeThread)).toBeCloseTo(0.00008);
  });

  it('attachment footer points data files toward inspect_file before fs', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.createThread();

    chat.sendMessage('what is in this csv?', [
      { filename: 'scores.csv', path: '/workspace/attachments/scores.csv', size: 42, mime: 'text/csv' },
    ]);
    await flush(20);

    const userMessage = mock.calls[0].messages.find(m => m.role === 'user');
    expect(userMessage?.content).toContain('inspect_file');
    expect(userMessage?.content).toContain('fs for byte-level reads');
    expect(userMessage?.content).not.toContain('read with the `fs` tool');
  });

  it('injects fresh runtime context into the system prompt', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.setToolStoresProvider(() => ({
      bridge: onlineBridge(),
    }) as unknown as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream'>);
    chat.createThread();

    chat.sendMessage('where are you running?');
    await flush(40);

    const sys = mock.calls[0].systemPrompt ?? '';
    expect(sys).toContain('Runtime context:');
    expect(sys).toMatch(/iso: \d{4}-\d{2}-\d{2}T/);
    expect(sys).toContain('timezone:');
    expect(sys).toContain('bridge: online');
    expect(sys).toContain('workspace_paths: /workspace/attachments, /workspace/notes, /workspace/artifacts');
    expect(sys).toContain('terminal_cwd: bridge workspace root');
  });

  it('tokenUsage includes the composed system prompt and reserved reply budget', () => {
    const { chat, profile } = setup();
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-gpt-5.5');
    profile.setDefaultSystemPrompt('x'.repeat(40_000));

    const usage = chat.tokenUsage('');

    expect(usage.used).toBeGreaterThan(10_000);
  });

  it('tokenUsage includes expanded tool result content from the wire payload', () => {
    const { chat } = setup();
    chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-large-tool',
        role: 'user',
        content: 'Use the CSV data.',
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-large-tool',
        role: 'assistant',
        content: 'Imported.',
        createdAt: Date.now(),
        toolCalls: [{ id: 'call-large', name: 'fs', arguments: { action: 'read', path: '/workspace/artifacts/huge.json' } }],
        toolResults: [{
          toolCallId: 'call-large',
          toolName: 'fs',
          content: 'y'.repeat(80_000),
          ranAt: Date.now(),
        }],
      });
    });

    const usage = chat.tokenUsage('');

    expect(usage.used).toBeGreaterThan(20_000);
  });

  it('does not call the provider when the preflight payload still exceeds the model context', async () => {
    const { chat, mock, profile } = setup([
      { type: 'text', delta: 'should-not-stream' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-deepseek-v4-flash');
    profile.setDefaultSystemPrompt('z'.repeat(600_000));

    chat.sendMessage('hi');
    await flush(20);

    expect(mock.calls).toHaveLength(0);
    const reply = chat.activeThread!.messages.at(-1);
    expect(reply).toMatchObject({ role: 'assistant' });
    expect(messageText(reply!)).toContain('too large');
    expect(chat.streamingMessageId).toBeNull();
  });

  it('compacts oversized prior tool results before retrying the original model request', async () => {
    const { chat, mock, providers } = setup([
      { type: 'text', delta: 'continued' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-deepseek-v4-flash');
    const unavailableProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => false,
      async *stream() { /* never called */ },
    };
    const router = providers.router as LlmRouter & {
      resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
    };
    router.resolve = (modelId: string) => {
      if (modelId === 'or-deepseek-v4-flash') return { provider: mock, providerModelId: modelId };
      return { provider: unavailableProvider, providerModelId: modelId };
    };
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-big-context',
        role: 'user',
        content: 'Read the generated artifact.',
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-big-context',
        role: 'assistant',
        content: 'Read it.',
        createdAt: Date.now(),
        toolCalls: [{ id: 'call-big', name: 'fs', arguments: { action: 'read', path: '/workspace/artifacts/huge.json' } }],
        toolResults: [{
          toolCallId: 'call-big',
          toolName: 'fs',
          content: 'path: /workspace/artifacts/huge.json\n' + 'd'.repeat(550_000),
          ranAt: Date.now(),
        }],
      });
    });

    chat.sendMessage('continue');
    await flush(80);

    expect(mock.calls).toHaveLength(1);
    expect(chat.activeThread!.messages.at(-1)?.role).toBe('assistant');
    expect(messageText(chat.activeThread!.messages.at(-1)!)).toBe('continued');
    const compacted = chat.activeThread!.messages.find(m => m.id === 'a-big-context');
    if (compacted?.role !== 'assistant') throw new Error('expected assistant');
    expect(messageToolResults(compacted)[0].content).toContain('[compacted tool result]');
    expect(messageToolResults(compacted)[0].content).toContain('/workspace/artifacts/huge.json');
  });

  it('prefers a cheap configured model for compaction before the original request', async () => {
    const { chat, mock, providers } = setup([
      { type: 'text', delta: 'after compaction' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const compactModelIds: string[] = [];
    const unavailableProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => false,
      async *stream() { /* never called */ },
    };
    const compactorProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream(req: LlmRequest) {
        compactModelIds.push(req.modelId);
        yield { type: 'text', delta: 'Model summary preserving /workspace/artifacts/huge.json' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const router = providers.router as LlmRouter & {
      resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
    };
    router.resolve = (modelId: string) => {
      if (modelId === 'or-gemini-3.1-flash-lite') return { provider: compactorProvider, providerModelId: 'google/gemini-3.1-flash-lite' };
      if (modelId === chat.activeThread?.modelId) return { provider: mock, providerModelId: modelId };
      return { provider: unavailableProvider, providerModelId: modelId };
    };

    const id = chat.createThread();
    chat.setThreadModel(id, 'or-deepseek-v4-flash');
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-cheap-compact',
        role: 'user',
        content: 'Read the generated artifact.',
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-cheap-compact',
        role: 'assistant',
        content: 'Read it.',
        createdAt: Date.now(),
        toolCalls: [{ id: 'call-cheap', name: 'fs', arguments: { action: 'read', path: '/workspace/artifacts/huge.json' } }],
        toolResults: [{
          toolCallId: 'call-cheap',
          toolName: 'fs',
          content: 'path: /workspace/artifacts/huge.json\n' + 'e'.repeat(550_000),
          ranAt: Date.now(),
        }],
      });
    });

    chat.sendMessage('continue');
    await flush(100);

    expect(compactModelIds).toEqual(['google/gemini-3.1-flash-lite']);
    expect(mock.calls).toHaveLength(1);
    const compacted = chat.activeThread!.messages.find(m => m.id === 'a-cheap-compact');
    if (compacted?.role !== 'assistant') throw new Error('expected assistant');
    expect(messageToolResults(compacted)[0].content).toContain('Model summary preserving /workspace/artifacts/huge.json');
  });

  it('selectThread does NOT cancel an in-flight stream on the previous thread', async () => {
    const slow: Parameters<MockProvider['setChunks']>[0] = [];
    for (let i = 0; i < 10; i++) slow.push({ type: 'text', delta: 'x'.repeat(48) });
    slow.push({ type: 'done', finishReason: 'stop' });

    const { chat, mock } = setup(slow);
    const a = chat.createThread();
    chat.sendMessage('start');
    await flush(2);
    expect(chat.isThreadStreaming(a)).toBe(true);

    const b = chat.createThread();
    expect(chat.activeThreadId).toBe(b);
    // The other thread keeps streaming; only the active-thread getter changes.
    expect(chat.isStreaming).toBe(false);
    expect(chat.isThreadStreaming(a)).toBe(true);
    expect(mock.abortedAt).toBeNull();

    // Switch back; the stream keeps going / completes uninterrupted.
    chat.selectThread(a);
    await flush(300);
    const first = chat.threads.find(t => t.id === a)!;
    const reply = first.messages.find(m => m.role === 'assistant')!;
    // Should have grown well past the switch-point (more than the ~2 ticks
    // before the switch) and never been annotated as interrupted.
    expect(messageText(reply).length).toBeGreaterThan(50);
    expect(messageText(reply)).not.toContain('[interrupted]');
    expect(mock.abortedAt).toBeNull();
  });

  it('stopStreaming aborts the active thread and annotates the partial', async () => {
    const long: Parameters<MockProvider['setChunks']>[0] = [];
    for (let i = 0; i < 50; i++) long.push({ type: 'text', delta: 'x' });
    long.push({ type: 'done', finishReason: 'stop' });

    const { chat } = setup(long);
    chat.createThread();
    chat.sendMessage('go');
    await flush(2);
    expect(chat.streamingMessageId).not.toBeNull();

    chat.stopStreaming();
    expect(chat.streamingMessageId).toBeNull();
    const reply = chat.activeThread!.messages.find(m => m.role === 'assistant')!;
    expect(messageText(reply)).toContain('[interrupted]');
  });

  it('sending while streaming interrupts and starts a new turn on the same thread', async () => {
    const slow: Parameters<MockProvider['setChunks']>[0] = [];
    for (let i = 0; i < 50; i++) slow.push({ type: 'text', delta: 'a' });
    slow.push({ type: 'done', finishReason: 'stop' });

    const { chat, mock } = setup(slow);
    chat.createThread();
    chat.sendMessage('first');
    await flush(2);
    const firstStreamingId = chat.streamingMessageId;
    expect(firstStreamingId).not.toBeNull();

    // Swap chunks for the second turn and interrupt with a new message.
    mock.setChunks([
      { type: 'text', delta: 'second-reply' },
      { type: 'done', finishReason: 'stop' },
    ]);
    chat.sendMessage('second');

    const replacement = chat.activeThread!.messages.at(-1);
    expect(replacement).toMatchObject({ role: 'assistant', preTokenLabel: 'responding' });
    expect(messageText(replacement!)).toBe('');

    await flush(20);

    const messages = chat.activeThread!.messages;
    // user1, assistant1 (interrupted), user2, assistant2 (complete)
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('user');
    expect(messageText(messages[0])).toBe('first');
    expect(messages[1].role).toBe('assistant');
    expect(messageText(messages[1])).toContain('[interrupted]');
    expect(messages[2].role).toBe('user');
    expect(messageText(messages[2])).toBe('second');
    expect(messages[3].role).toBe('assistant');
    expect(messageText(messages[3])).toBe('second-reply');
    expect(chat.streamingMessageId).toBeNull();
    expect(mock.abortedAt).not.toBeNull();
  });

  it('marks in-flight tools cancelled when the turn is interrupted', async () => {
    let releaseTool: (() => void) | null = null;
    toolRegistry.register({
      def: {
        name: 'slow_test_tool',
        description: 'test-only slow tool',
        parameters: { type: 'object', properties: {} },
      },
      meta: { category: 'time', hasSideEffects: () => true },
      execute: async (_args, ctx) => {
        await new Promise<void>(resolve => { releaseTool = resolve; });
        return ctx.signal?.aborted ? 'aborted after release' : 'late result';
      },
    });
    const { chat } = setup([
      { type: 'tool_call', call: { id: 'call-slow', name: 'slow_test_tool', arguments: {} } },
      { type: 'done', finishReason: 'tool_use' },
    ]);
    chat.createThread();

    chat.sendMessage('use slow tool');
    await flush(10);
    const assistant = chat.activeThread!.messages.find(m => m.role === 'assistant')!;
    expect(assistant.role === 'assistant' ? messageToolCalls(assistant)[0]?.name : undefined).toBe('slow_test_tool');

    chat.stopStreaming();
    (releaseTool as (() => void) | null)?.();
    await flush(10);

    expect(assistant.role === 'assistant' ? messageToolResults(assistant)[0] : undefined).toMatchObject({
      toolCallId: 'call-slow',
      ok: false,
      errorCode: 'cancelled',
    });
    expect(messageText(assistant)).toContain('[no response]');
  });

  it('interrupting a thinking (zero-token) reply leaves the no-response placeholder', async () => {
    // Stream that hangs forever without yielding any text.
    const hang: Parameters<MockProvider['setChunks']>[0] = [];
    for (let i = 0; i < 200; i++) hang.push({ type: 'text', delta: '' });
    hang.push({ type: 'done', finishReason: 'stop' });

    const { chat } = setup(hang);
    chat.createThread();
    chat.sendMessage('hi');
    await flush(2);

    chat.stopStreaming();
    const reply = chat.activeThread!.messages.find(m => m.role === 'assistant')!;
    expect(messageText(reply)).toBe('*[no response]*');
  });

  it('aborts and explains a provider stream that stops sending data', async () => {
    vi.useFakeTimers();
    const { chat, providers } = setup();
    const stalledProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream(_req: LlmRequest, signal: AbortSignal) {
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'done', finishReason: 'cancelled' };
      },
    };
    installMockProvider(providers, stalledProvider);
    chat.createThread();

    chat.sendMessage('hang please');
    await flush(5);
    const messageId = chat.streamingMessageId;
    expect(messageId).not.toBeNull();
    expect(chat.streamActivityByThread[chat.activeThreadId!]).toMatchObject({
      messageId,
      phase: 'connecting',
    });

    vi.advanceTimersByTime(PROVIDER_STREAM_INITIAL_STALL_MS + 1);
    await flush(20);

    expect(chat.streamingMessageId).toBeNull();
    const reply = chat.activeThread!.messages.find(m => m.role === 'assistant')!;
    expect(reply.finishReason).toBe('error');
    expect(messageText(reply)).toContain('No provider data arrived');
    expect(chat.lastError).toContain('No provider data arrived');
  });

  it('aborts a provider stream that goes idle after partial text', async () => {
    vi.useFakeTimers();
    const { chat, providers } = setup();
    const stalledProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream(_req: LlmRequest, signal: AbortSignal) {
        yield { type: 'text', delta: 'Let me build that.' };
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'done', finishReason: 'cancelled' };
      },
    };
    installMockProvider(providers, stalledProvider);
    chat.createThread();

    chat.sendMessage('make a game');
    await flush(10);
    vi.advanceTimersByTime(30);
    await flush(10);
    expect(messageText(chat.activeThread!.messages.find(m => m.role === 'assistant')!)).toContain('Let');
    expect(chat.streamActivityByThread[chat.activeThreadId!]).toMatchObject({ phase: 'streaming' });

    vi.advanceTimersByTime(PROVIDER_STREAM_STALL_MS + 1);
    await flush(20);

    expect(chat.streamingMessageId).toBeNull();
    const reply = chat.activeThread!.messages.find(m => m.role === 'assistant')!;
    expect(reply.finishReason).toBe('error');
    expect(messageText(reply)).toContain('Let me build that.');
    expect(messageText(reply)).toContain('No provider data arrived');
  });

  it('persists snapshot to localStorage and restores on reload', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'persisted' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    chat.sendMessage('save me');
    await waitForLocalStorageSnapshot(
      snapshot => snapshot.threads.some(thread =>
        thread.id === id && thread.messages.map(messageText).join('\n') === 'save me\npersisted',
      ),
      'persisted chat turn',
    );

    // Build a brand-new store; it should pick up the snapshot.
    const registry2 = new ModelRegistry();
    const providers2 = new ProviderStore(registry2);
    const profile2 = new UserProfileStore();
    const mock2 = new MockProvider();
    installMockProvider(providers2, mock2);
    const chat2 = trackChat(new ChatStore(providers2, registry2, profile2));

    const restored = chat2.threads.find(t => t.id === id);
    expect(restored).toBeDefined();
    expect(restored!.messages.map(messageText)).toEqual(['save me', 'persisted']);
  });

  it('records the provider error in lastError when stream returns done:error', async () => {
    const { chat } = setup([
      { type: 'done', finishReason: 'error', error: 'rate limit' },
    ]);
    chat.createThread();
    chat.sendMessage('boom');
    await flush(10);

    expect(chat.lastError).toBe('rate limit');
    expect(chat.streamingMessageId).toBeNull();
  });

  it('keeps lastError scoped to the thread that failed', async () => {
    const { chat } = setup([
      { type: 'done', finishReason: 'error', error: 'thread A failed' },
    ]);
    const threadA = chat.activeThreadId!;
    chat.sendMessage('boom on A');
    await flush(10);
    expect(chat.lastError).toBe('thread A failed');
    expect(chat.lastErrorByThread[threadA]).toBe('thread A failed');

    const threadB = chat.createThread();
    expect(chat.activeThreadId).toBe(threadB);
    expect(chat.lastError).toBeNull();

    chat.selectThread(threadA);
    expect(chat.lastError).toBe('thread A failed');

    chat.clearLastError();
    expect(chat.lastErrorByThread[threadA]).toBeUndefined();
    chat.selectThread(threadB);
    expect(chat.lastError).toBeNull();
  });

  it('pauses local saves after another tab writes chat storage', async () => {
    const listeners = new Map<string, EventListener>();
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      listeners.set(type, handler as EventListener);
    });
    installMultiTabStorageListener();

    const { chat } = setup();
    const threadId = chat.activeThreadId!;
    chat.renameThread(threadId, 'Before conflict');
    await flush(300);

    const before = loadSnapshot();
    expect(before?.threads.find(t => t.id === threadId)?.title).toBe('Before conflict');

    const storageHandler = listeners.get('storage');
    expect(storageHandler).toBeTypeOf('function');
    storageHandler!(new StorageEvent('storage', {
      key: CHAT_SNAPSHOT_STORAGE_KEY,
      oldValue: JSON.stringify(before),
      newValue: JSON.stringify({
        ...before,
        threads: before!.threads.map(t => ({ ...t, title: 'External overwrite' })),
      }),
      storageArea: localStorage,
    }));

    expect(chat.persistenceConflict).toMatch(/Another browser tab/);
    chat.renameThread(threadId, 'After conflict');
    await flush(300);
    expect(loadSnapshot()?.threads.find(t => t.id === threadId)?.title).toBe('Before conflict');

    chat.dismissPersistenceConflict();
    chat.renameThread(threadId, 'After dismiss');
    await flush(300);
    expect(loadSnapshot()?.threads.find(t => t.id === threadId)?.title).toBe('After dismiss');
  });

  it('suppresses follower persistence until the Web Locks leader hands over', async () => {
    disposeActiveChats();
    flushPendingSnapshot();
    clearAppStorage();
    const locks = new MockWebLocks();
    const currentLeader = new WebLocksLeaderElection({ locks });
    const followerElection = new WebLocksLeaderElection({ locks });
    currentLeader.start();
    await settleWebLock();
    followerElection.start();

    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const follower = trackChat(new ChatStore(
      providers,
      registry,
      new UserProfileStore(),
      () => true,
      followerElection,
    ));
    const threadId = follower.activeThreadId!;
    expect(follower.isReadOnlyFollower).toBe(true);
    follower.renameThread(threadId, 'Unsaved follower edit');
    await flush(300);
    expect(loadSnapshot()).toBeNull();

    currentLeader.dispose();
    await settleWebLock();
    expect(follower.isReadOnlyFollower).toBe(false);
    await flush(300);
    expect(loadSnapshot()?.threads.find(thread => thread.id === threadId)?.title).not.toBe('Unsaved follower edit');

    followerElection.dispose();
  });

  it('omits tools from the request when the active model has supportsTools=false', async () => {
    const { chat, mock, registry } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    registry.setDynamicForProvider('ollama', [
      {
        id: 'ollama-gemma2',
        name: 'Gemma 2 (Ollama)',
        vendor: 'Ollama',
        providerId: 'ollama',
        providerModelId: 'gemma2',
        supportsTools: false,
      },
      {
        id: 'ollama-llama3.1',
        name: 'Llama 3.1 (Ollama)',
        vendor: 'Ollama',
        providerId: 'ollama',
        providerModelId: 'llama3.1',
        // supportsTools undefined => allow tools (positive control)
      },
    ]);
    chat.setToolStoresProvider(() => ({ bridge: onlineBridge() }));

    // Negative case: tools dropped for supportsTools=false
    const noToolsId = chat.createThread();
    chat.setThreadModel(noToolsId, 'ollama-gemma2');
    chat.sendMessage('hi');
    await flush(20);
    const gemmaCall = mock.calls.find(c => c.modelId === 'ollama-gemma2');
    expect(gemmaCall).toBeDefined();
    expect(gemmaCall!.tools).toBeUndefined();

    // Positive control: a normal model still receives tools.
    const withToolsId = chat.createThread();
    chat.setThreadModel(withToolsId, 'ollama-llama3.1');
    chat.sendMessage('create an html file');
    await flush(20);
    const llamaCall = mock.calls.find(c => c.modelId === 'ollama-llama3.1');
    expect(llamaCall).toBeDefined();
    expect(Array.isArray(llamaCall!.tools)).toBe(true);
    expect((llamaCall!.tools ?? []).length).toBeGreaterThan(0);
  });

  it('can send local Ollama turns with system/tools but without prior chat history', async () => {
    const { chat, mock, registry } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3.1',
      name: 'Llama 3.1 (Ollama)',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3.1',
    }]);
    chat.setThreadModel(chat.activeThreadId!, 'ollama-llama3.1');
    chat.setThreadContextMode(chat.activeThreadId!, 'system-tools');
    runInAction(() => {
      chat.activeThread!.messages.push({ id: 'u-old', role: 'user', content: 'old user context', createdAt: 1 });
      chat.activeThread!.messages.push({ id: 'a-old', role: 'assistant', content: 'old assistant context', createdAt: 2 });
    });

    chat.sendMessage('current prompt');
    await flush(20);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages).toEqual([{ role: 'user', content: 'current prompt' }]);
    expect(mock.calls[0].systemPrompt).toBeTruthy();
    expect((mock.calls[0].tools ?? []).length).toBeGreaterThan(0);
  });

  it('can send local Ollama turns as a bare current prompt with no tools or system prompt', async () => {
    const { chat, mock, registry } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-tiny',
      name: 'Tiny (Ollama)',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'tiny',
    }]);
    chat.setThreadModel(chat.activeThreadId!, 'ollama-tiny');
    chat.setThreadContextMode(chat.activeThreadId!, 'bare');
    runInAction(() => {
      chat.activeThread!.messages.push({ id: 'u-old', role: 'user', content: 'old user context', createdAt: 1 });
      chat.activeThread!.messages.push({ id: 'a-old', role: 'assistant', content: 'old assistant context', createdAt: 2 });
    });

    chat.sendMessage('fit this');
    await flush(20);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages).toEqual([{ role: 'user', content: 'fit this' }]);
    expect(mock.calls[0].systemPrompt).toBeUndefined();
    expect(mock.calls[0].tools).toBeUndefined();
  });

  it('can send local Ollama turns in micro mode with tiny prompt, source tools, fs, and small output reserve', async () => {
    const { chat, mock, registry } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-micro',
      name: 'Micro (Ollama)',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'micro',
    }]);
    chat.setToolStoresProvider(() => ({ bridge: onlineBridge() }));
    chat.setThreadModel(chat.activeThreadId!, 'ollama-micro');
    chat.setThreadContextMode(chat.activeThreadId!, 'micro');
    runInAction(() => {
      chat.activeThread!.threadContext = 'remembered context that should not be sent';
      chat.activeThread!.messages.push({ id: 'u-old', role: 'user', content: 'old user context', createdAt: 1 });
      chat.activeThread!.messages.push({ id: 'a-old', role: 'assistant', content: 'old assistant context', createdAt: 2 });
    });

    chat.sendMessage('create an html file');
    await flush(20);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages).toEqual([{ role: 'user', content: 'create an html file' }]);
    expect(mock.calls[0].systemPrompt).toContain('Minimal local mode.');
    expect(mock.calls[0].systemPrompt).not.toContain('remembered context');
    expect(mock.calls[0].tools?.map(tool => tool.name)).toEqual(['source_workspace', 'source_build', 'fs']);
    expect(mock.calls[0].maxTokens).toBe(512);
  });

  it('defaults local Ollama turns to micro mode when no context mode was selected', async () => {
    const { chat, mock, registry } = setup([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]);
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-default-micro',
      name: 'Default Micro (Ollama)',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'default-micro',
    }]);
    chat.setToolStoresProvider(() => ({ bridge: onlineBridge() }));
    chat.setThreadModel(chat.activeThreadId!, 'ollama-default-micro');

    chat.sendMessage('create an html file');
    await flush(20);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages).toEqual([{ role: 'user', content: 'create an html file' }]);
    expect(mock.calls[0].systemPrompt).toContain('Minimal local mode.');
    expect(mock.calls[0].tools?.map(tool => tool.name)).toEqual(['source_workspace', 'source_build', 'fs']);
    expect(mock.calls[0].maxTokens).toBe(512);
  });

  it('rescues Ollama pseudo fs.write prose into a real tool call', async () => {
    const { chat, providers, registry } = setup();
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-gemma3',
      name: 'Gemma 3 (Ollama)',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'gemma3',
      contextLength: 128000,
    }]);
    const requests: LlmRequest[] = [];
    let streamCount = 0;
    const localProvider: LlmProvider = {
      id: 'ollama',
      ready: () => true,
      async *stream(req: LlmRequest) {
        requests.push(req);
        streamCount += 1;
        if (streamCount === 1) {
          yield {
            type: 'text',
            delta: 'I will do it:\n```js\nfs.write({ path: "/workspace/game.html", contents: `<html><body>play</body></html>` })\n```',
          };
        } else {
          yield { type: 'text', delta: 'Created the game file.' };
        }
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const router = providers.router as LlmRouter & {
      resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
      canRoute: () => boolean;
    };
    router.resolve = modelId => ({ provider: localProvider, providerModelId: modelId });
    router.canRoute = () => true;
    const writes: unknown[] = [];
    chat.setToolStoresProvider(() => ({
      bridge: {
        isOnline: true,
        client: {
          request: async (op: string, data: unknown) => {
            writes.push({ op, data });
            return { bytes: 30, path: '/workspace/game.html' };
          },
        },
      },
    }) as unknown as Pick<ToolContext, 'bridge'>);
    chat.setThreadModel(chat.activeThreadId!, 'ollama-gemma3');

    chat.sendMessage('use the fs tool to create a cool game as an html file');
    await flush(40);

    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(writes).toEqual([{
      op: 'fs.write',
      data: expect.objectContaining({
        path: '/workspace/game.html',
        content: '<html><body>play</body></html>',
      }),
    }]);
    const assistant = chat.activeThread!.messages.findLast(m => m.role === 'assistant');
    expect(assistant?.role === 'assistant' ? messageToolCalls(assistant)[0] : undefined).toEqual(expect.objectContaining({
      name: 'fs',
      arguments: expect.objectContaining({ action: 'write', path: '/workspace/game.html' }),
    }));
    expect(assistant && messageText(assistant)).toBe('Created the game file.');
  });

  it('tokenUsage counts serialized tool calls, tool results, and selected tool schemas', () => {
    const { chat } = setup();
    chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-tool-heavy',
        role: 'user',
        content: 'Read the attached file.\n\n📎 Attached files (read with the `fs` tool):\n  - /workspace/attachments/data.csv · 10.7KB · text/csv',
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-tool-heavy',
        role: 'assistant',
        content: 'Finished.',
        createdAt: Date.now(),
        toolCalls: [{ id: 'call_fs', name: 'fs', arguments: { action: 'read', path: '/workspace/attachments/data.csv' } }],
        toolResults: [{ toolCallId: 'call_fs', toolName: 'fs', content: 'x'.repeat(1000), ranAt: Date.now() }],
      });
    });

    const usage = chat.tokenUsage('');

    expect(usage.used).toBeGreaterThan(estimateLowerBound('x'.repeat(1000)));
  });

  it('direct-image model enqueues an image job without calling an LLM provider', async () => {
    const { chat, mock } = setup();
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, 'image-direct-comfy');
    const enqueued: Parameters<NonNullable<ToolContext['imageJobs']>['enqueue']>[0][] = [];
    chat.setToolStoresProvider(() => ({
      imageGen: {
        backend: 'local-comfy',
        comfyWorkflowPath: undefined,
        getCredential: () => 'http://127.0.0.1:8188',
        toBackendConfig: () => ({
          primary: 'local-comfy',
          comfyBaseUrl: 'http://127.0.0.1:8188',
          comfyQualityPreset: 'full',
          comfyUpscaleFactor: 2,
        }),
      },
      localRuntime: { ollamaBaseUrl: '', comfyReady: true },
      imageJobs: {
        enqueue: (input) => {
          enqueued.push(input);
          return { jobId: 'job-1', count: input.count };
        },
      },
    }));

    chat.sendMessage('a glass city under rain');
    await flush(10);

    expect(mock.calls).toHaveLength(0);
    expect(enqueued).toEqual([expect.objectContaining({
      threadId,
      prompt: 'a glass city under rain',
      count: 1,
      width: 1024,
      height: 1024,
      backend: 'local-comfy',
    })]);
    expect(chat.activeThread!.messages.at(-1)?.role).toBe('assistant');
    expect(messageText(chat.activeThread!.messages.at(-1)!)).toContain('I queued an image through local ComfyUI');
  });

  it('direct-image turn is blocked with a clear message when ComfyUI is not ready', async () => {
    const { chat, mock } = setup();
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, 'image-direct-comfy');
    const enqueued: Parameters<NonNullable<ToolContext['imageJobs']>['enqueue']>[0][] = [];
    chat.setToolStoresProvider(() => ({
      imageGen: {
        backend: 'local-comfy',
        comfyWorkflowPath: undefined,
        getCredential: () => 'http://127.0.0.1:8188',
        toBackendConfig: () => ({
          primary: 'local-comfy',
          comfyBaseUrl: 'http://127.0.0.1:8188',
          comfyQualityPreset: 'full',
          comfyUpscaleFactor: 1,
        }),
      },
      localRuntime: { ollamaBaseUrl: '', comfyReady: false },
      imageJobs: {
        enqueue: (input) => {
          enqueued.push(input);
          return { jobId: 'job-1', count: input.count };
        },
      },
    }));

    chat.sendMessage('a glass city under rain');
    await flush(10);

    expect(mock.calls).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
    expect(chat.activeThread!.messages.at(-1)?.role).toBe('assistant');
    expect(messageText(chat.activeThread!.messages.at(-1)!)).toContain('ComfyUI is not running');
  });

  it('does not post an orphan image completion assistant message', () => {
    const { chat } = setup();
    const imageThreadId = chat.createThread();
    const otherThreadId = chat.createThread();
    const beforeCount = chat.threads.find(t => t.id === imageThreadId)!.messages.length;

    chat.notifyImageJobTerminal({
      id: 'job-ready',
      threadId: imageThreadId,
      prompt: 'a glass city under rain',
      count: 1,
      width: 1024,
      height: 1024,
      backend: 'openrouter-image',
      status: 'done',
      results: ['/workspace/artifacts/images/api/glass-city-1.png'],
      createdAt: 1,
      startedAt: 1000,
      completedAt: 45000,
    });

    expect(chat.activeThreadId).toBe(otherThreadId);
    const imageThread = chat.threads.find(t => t.id === imageThreadId)!;
    expect(imageThread.messages).toHaveLength(beforeCount);
  });

  it('keeps image terminal events in the existing image job card instead of chat prose', () => {
    const { chat } = setup();
    const threadId = chat.createThread();
    const base = {
      id: 'job-retry',
      threadId,
      prompt: 'a moon base',
      count: 1,
      width: 1024,
      height: 1024,
      backend: 'openrouter-image' as const,
      status: 'done' as const,
      results: ['/workspace/artifacts/images/api/moon-1.png'],
      createdAt: 1,
      startedAt: 1000,
    };

    chat.notifyImageJobTerminal({ ...base, completedAt: 5000 });
    chat.notifyImageJobTerminal({ ...base, completedAt: 5000 });
    chat.notifyImageJobTerminal({ ...base, completedAt: 9000 });

    const terminalMessages = chat.threads
      .find(t => t.id === threadId)!
      .messages
      .filter(m => m.role === 'assistant' && messageToolCalls(m).some(call => call.name === 'image_generate_complete'));
    expect(terminalMessages).toHaveLength(0);
  });

  it.each([
    ['image-direct-comfy-draft', 'draft'],
    ['image-direct-comfy', 'normal'],
    ['image-direct-comfy-upscale', 'upscale'],
  ] as const)('direct-image model %s enqueues the matching ComfyUI mode', async (modelId, comfyMode) => {
    const { chat } = setup();
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, modelId);
    const enqueued: Parameters<NonNullable<ToolContext['imageJobs']>['enqueue']>[0][] = [];
    chat.setToolStoresProvider(() => ({
      imageGen: {
        backend: 'local-comfy',
        comfyWorkflowPath: undefined,
        getCredential: () => 'http://127.0.0.1:8188',
        toBackendConfig: () => ({
          primary: 'local-comfy',
          comfyBaseUrl: 'http://127.0.0.1:8188',
          comfyQualityPreset: 'quick',
          comfyUpscaleFactor: 3,
        }),
      },
      localRuntime: { ollamaBaseUrl: '', comfyReady: true },
      imageJobs: {
        enqueue: (input) => {
          enqueued.push(input);
          return { jobId: 'job-1', count: input.count };
        },
      },
    }));

    chat.sendMessage('a tiny cabin in snow');
    await flush(10);

    expect(enqueued[0]).toEqual(expect.objectContaining({ comfyMode }));
  });

  it('direct-image token usage counts only the pending prompt', () => {
    const { chat } = setup();
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, 'image-direct-comfy');
    chat.setThreadContext(threadId, 'system-heavy context '.repeat(1000));
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-long',
        role: 'user',
        content: 'old chat context '.repeat(1000),
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-long',
        role: 'assistant',
        content: 'old assistant context '.repeat(1000),
        createdAt: Date.now(),
      });
    });

    const usage = chat.tokenUsage('small image prompt');

    expect(usage.used).toBeLessThan(100);
  });

  it('abandoned stream finalize does not stamp finishReason or auto-name after interrupt-resend', async () => {
    // The first stream parks on a test-controlled gate after its partial
    // chunk, so the test deterministically releases the "late" finalize after
    // the interrupt-resend instead of racing a real setTimeout.
    class LateFinalizeMockProvider implements LlmProvider {
      readonly id: ProviderId = 'openrouter';
      calls: LlmRequest[] = [];
      firstPartialDelivered = false;
      firstStreamFinished = false;
      release!: () => void;
      private readonly firstGate = new Promise<void>(resolve => { this.release = resolve; });
      private callIndex = 0;

      ready(): boolean { return true; }

      async *stream(req: LlmRequest, _signal: AbortSignal): AsyncIterable<LlmChunk> {
        this.calls.push(req);
        const n = this.callIndex++;
        if (n === 0) {
          try {
            yield { type: 'text', delta: 'partial abandoned' };
            this.firstPartialDelivered = true;
            await this.firstGate;
            yield { type: 'done', finishReason: 'stop' };
          } finally {
            this.firstStreamFinished = true;
          }
          return;
        }
        yield { type: 'text', delta: 'real-reply' };
        yield { type: 'done', finishReason: 'stop' };
      }
    }

    disposeActiveChats();
    flushPendingSnapshot();
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const mock = new LateFinalizeMockProvider();
    installMockProvider(providers, mock);
    const chat = trackChat(new ChatStore(providers, registry, profile));

    chat.createThread();
    chat.sendMessage('first');
    await vi.waitFor(() => expect(mock.firstPartialDelivered).toBe(true));
    chat.sendMessage('second');
    await vi.waitFor(() => expect(messageText(chat.activeThread!.messages.at(-1)!)).toBe('real-reply'));
    // Release the abandoned first stream so its finalize actually runs.
    mock.release();
    await vi.waitFor(() => expect(mock.firstStreamFinished).toBe(true));
    await flush();

    const messages = chat.activeThread!.messages;
    const interrupted = messages.find(m => m.role === 'assistant' && messageText(m).includes('[interrupted]'));
    expect(interrupted).toBeDefined();
    if (interrupted?.role === 'assistant') {
      expect(interrupted.finishReason).toBeUndefined();
    }
    expect(chat.activeThread!.autoNamed).toBeFalsy();
    const finalReply = messages.at(-1);
    expect(finalReply?.role).toBe('assistant');
    expect(messageText(finalReply!)).toBe('real-reply');
  });

  it('abandoned stream error finalize does not stamp finishReason after interrupt-resend', async () => {
    // Same gate pattern as above: the abandoned stream's error finalize is
    // released by the test instead of racing a real setTimeout.
    class LateErrorFinalizeMockProvider implements LlmProvider {
      readonly id: ProviderId = 'openrouter';
      calls: LlmRequest[] = [];
      firstPartialDelivered = false;
      firstStreamFinished = false;
      release!: () => void;
      private readonly firstGate = new Promise<void>(resolve => { this.release = resolve; });
      private callIndex = 0;

      ready(): boolean { return true; }

      async *stream(req: LlmRequest, _signal: AbortSignal): AsyncIterable<LlmChunk> {
        this.calls.push(req);
        const n = this.callIndex++;
        if (n === 0) {
          try {
            yield { type: 'text', delta: 'partial abandoned' };
            this.firstPartialDelivered = true;
            await this.firstGate;
            yield { type: 'done', finishReason: 'error', error: 'provider blew up' };
          } finally {
            this.firstStreamFinished = true;
          }
          return;
        }
        yield { type: 'text', delta: 'real-reply' };
        yield { type: 'done', finishReason: 'stop' };
      }
    }

    disposeActiveChats();
    flushPendingSnapshot();
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const mock = new LateErrorFinalizeMockProvider();
    installMockProvider(providers, mock);
    const chat = trackChat(new ChatStore(providers, registry, profile));

    chat.createThread();
    chat.sendMessage('first');
    await vi.waitFor(() => expect(mock.firstPartialDelivered).toBe(true));
    chat.sendMessage('second');
    await vi.waitFor(() => expect(messageText(chat.activeThread!.messages.at(-1)!)).toBe('real-reply'));
    // Release the abandoned first stream so its error finalize actually runs.
    mock.release();
    await vi.waitFor(() => expect(mock.firstStreamFinished).toBe(true));
    await flush();

    const messages = chat.activeThread!.messages;
    const interrupted = messages.find(m => m.role === 'assistant' && messageText(m).includes('[interrupted]'));
    expect(interrupted).toBeDefined();
    if (interrupted?.role === 'assistant') {
      expect(interrupted.finishReason).toBeUndefined();
    }
    expect(chat.activeThread!.autoNamed).toBeFalsy();
    expect(chat.lastError).toBeNull();
    const finalReply = messages.at(-1);
    expect(finalReply?.role).toBe('assistant');
    expect(messageText(finalReply!)).toBe('real-reply');
  });

  it('manual rename prevents auto-naming from overwriting the user title', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'assistant body long enough to name from' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const threadId = chat.createThread();
    chat.renameThread(threadId, 'My Custom Title');
    chat.sendMessage('hello naming guard');
    await flush(30);
    expect(chat.threads.find(t => t.id === threadId)?.title).toBe('My Custom Title');
    expect(chat.threads.find(t => t.id === threadId)?.autoNamed).toBe(true);
  });

  it('auto-naming does not revive a thread soft-deleted while the namer is in flight', async () => {
    // Main turn completes immediately (so `maybeAutoName` fires), but the namer
    // call is gated so we can soft-delete before it resolves.
    let releaseNamer: () => void = () => {};
    const namerGate = new Promise<void>((resolve) => { releaseNamer = resolve; });
    class GatedNamerProvider implements LlmProvider {
      readonly id: ProviderId = 'openrouter';
      ready(): boolean { return true; }
      async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
        if ((req.systemPrompt ?? '').includes('name conversations')) {
          await namerGate;
          yield { type: 'text', delta: 'Generated Title' };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        yield { type: 'text', delta: 'assistant reply body long enough to name from' };
        yield { type: 'done', finishReason: 'stop' };
      }
    }

    disposeActiveChats();
    flushPendingSnapshot();
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    installMockProvider(providers, new GatedNamerProvider());
    // `canRoute` checks the real provider map (not the patched `resolve`), and a
    // keyless test provider isn't "ready"; force it so the namer path runs.
    (providers.router as unknown as { canRoute: () => boolean }).canRoute = () => true;
    const chat = trackChat(new ChatStore(providers, registry, profile));

    const threadId = chat.createThread();
    chat.sendMessage('hello soft-delete naming');
    await flush(10);
    expect(chat.threads.find(t => t.id === threadId)?.naming).toBe(true);

    chat.softDeleteThread(threadId);
    releaseNamer();
    await flush(10);

    const thread = chat.threads.find(t => t.id === threadId);
    expect(thread?.deletedAt).toBeTruthy();
    expect(thread?.autoNamed).toBeFalsy();
    expect(thread?.title).not.toBe('Generated Title');
  });

  it('direct-image prompt uses only the user-authored body, not attachment footer context', async () => {
    const { chat } = setup();
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, 'image-direct-comfy');
    const enqueued: Parameters<NonNullable<ToolContext['imageJobs']>['enqueue']>[0][] = [];
    chat.setToolStoresProvider(() => ({
      imageGen: {
        backend: 'local-comfy',
        comfyWorkflowPath: undefined,
        getCredential: () => 'http://127.0.0.1:8188',
        toBackendConfig: () => ({
          primary: 'local-comfy',
          comfyBaseUrl: 'http://127.0.0.1:8188',
          comfyQualityPreset: 'full',
          comfyUpscaleFactor: 1,
        }),
      },
      localRuntime: { ollamaBaseUrl: '', comfyReady: true },
      imageJobs: {
        enqueue: (input) => {
          enqueued.push(input);
          return { jobId: 'job-1', count: input.count };
        },
      },
    }));

    chat.sendMessage('a quiet forest shrine', [
      { filename: 'notes.txt', path: '/workspace/attachments/notes.txt', size: 1000, mime: 'text/plain' },
    ]);
    await flush(10);

    expect(enqueued[0]?.prompt).toBe('a quiet forest shrine');
  });
});

function estimateLowerBound(text: string): number {
  return Math.ceil(text.length / 4);
}

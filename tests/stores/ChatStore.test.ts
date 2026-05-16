import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStore, threadLlmSpendUsd } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { LlmProvider, LlmRequest } from '../../src/core/llm';
import type { LlmRouter } from '../../src/services/llm/router';
import type { BridgeClientFacade, ToolContext } from '../../src/services/tools/types';
import { MockProvider, flush, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';
import { toolRegistry } from '../../src/services/tools/registry';
import { WORKSPACE_CHAT_STATE_PATH } from '../../src/services/workspaceChatPersistence';

function setup(chunks?: Parameters<MockProvider['setChunks']>[0]) {
  clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const mock = new MockProvider(chunks);
  installMockProvider(providers, mock);
  const chat = new ChatStore(providers, registry, profile);
  return { registry, providers, profile, mock, chat };
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

describe('ChatStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('creates exactly one empty untitled thread when no snapshot exists', () => {
    const { chat } = setup();
    expect(chat.threads).toHaveLength(1);
    expect(chat.threads[0].messages).toEqual([]);
    expect(chat.threads[0].title).toBe('New conversation');
    expect(chat.activeThreadId).toBe(chat.threads[0].id);
  });

  it('defaults persisted unresolved thread models back to Gemini 3 Flash', () => {
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

    expect(chat.activeThread?.modelId).toBe('or-gemini-3-flash');
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

  it('repairs a live unresolved active model before sending', () => {
    const { chat } = setup();
    chat.setThreadModel(chat.activeThreadId!, 'missing-model');

    chat.sendMessage('hello');

    expect(chat.activeThread?.modelId).toBe('or-gemini-3-flash');
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

  it('branches a thread through a selected message while preserving model and context', () => {
    const { chat } = setup();
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-gpt-5.5');
    chat.setThreadContextMode(id, 'system-tools');
    chat.setThreadContext(id, 'keep this context');
    runInAction(() => {
      chat.activeThread!.title = 'Research';
      chat.activeThread!.pinned = true;
      chat.activeThread!.autoNamed = true;
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'one', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'two', createdAt: 2, model: 'or-gpt-5.5' },
        { id: 'u2', role: 'user', content: 'three', createdAt: 3 },
      );
    });

    const branchId = chat.branchThreadFromMessage(id, 'a1');
    const branch = chat.threads.find(t => t.id === branchId);

    expect(branch).toBeDefined();
    expect(branch?.title).toBe('Research (branch)');
    expect(branch?.pinned).toBe(false);
    expect(branch?.autoNamed).toBeUndefined();
    expect(branch?.modelId).toBe('or-gpt-5.5');
    expect(branch?.contextMode).toBe('system-tools');
    expect(branch?.threadContext).toBe('keep this context');
    expect(branch?.messages.map(m => m.id)).toEqual(['u1', 'a1']);
    expect(chat.activeThreadId).toBe(branchId);
  });

  it('does not branch or edit-and-resend while the source thread is streaming', () => {
    const { chat } = setup();
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'one', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'streaming', createdAt: 2, model: 'or-gemini-3-flash' },
      );
      (chat as unknown as { streamingByThread: Record<string, string> }).streamingByThread[id] = 'a1';
    });

    expect(chat.branchThreadFromMessage(id, 'u1')).toBeNull();
    expect(chat.editAndResendFromMessage(id, 'u1', 'edited')).toBeNull();
    expect(chat.threads).toHaveLength(2);
  });

  it('regenerates the latest assistant response in place', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'replacement' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'prompt', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'old answer', createdAt: 2, model: 'or-gemini-3-flash' },
      );
    });

    const resultId = chat.regenerateFromMessage(id, 'a1');
    await flush(20);

    expect(resultId).toBe(id);
    expect(chat.activeThread?.messages.map(m => m.content)).toEqual(['prompt', 'replacement']);
    expect(mock.calls).toHaveLength(1);
  });

  it('regenerates a historical assistant response on a branch', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'branched answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.title = 'History';
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'old first', createdAt: 2, model: 'or-gemini-3-flash' },
        { id: 'u2', role: 'user', content: 'second', createdAt: 3 },
        { id: 'a2', role: 'assistant', content: 'second answer', createdAt: 4, model: 'or-gemini-3-flash' },
      );
    });

    const branchId = chat.regenerateFromMessage(id, 'a1');
    await flush(20);

    const original = chat.threads.find(t => t.id === id)!;
    const branch = chat.threads.find(t => t.id === branchId)!;
    expect(original.messages.map(m => m.content)).toEqual(['first', 'old first', 'second', 'second answer']);
    expect(branch.title).toBe('History (branch)');
    expect(branch.messages.map(m => m.content)).toEqual(['first', 'branched answer']);
    expect(mock.calls).toHaveLength(1);
  });

  it('does not regenerate historical messages while the thread is streaming', () => {
    const { chat } = setup();
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'old first', createdAt: 2, model: 'or-gemini-3-flash' },
        { id: 'u2', role: 'user', content: 'second', createdAt: 3 },
        { id: 'a2', role: 'assistant', content: 'streaming second', createdAt: 4, model: 'or-gemini-3-flash' },
      );
      (chat as unknown as { streamingByThread: Record<string, string> }).streamingByThread[id] = 'a2';
    });

    expect(chat.regenerateFromMessage(id, 'a1')).toBeNull();
    expect(chat.threads).toHaveLength(2);
  });

  it('edit-and-resend creates a branch before the edited user message and preserves attachments', async () => {
    const { chat, mock } = setup([
      { type: 'text', delta: 'edited answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    runInAction(() => {
      chat.activeThread!.title = 'Draft';
      chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'answer', createdAt: 2, model: 'or-gemini-3-flash' },
        {
          id: 'u2',
          role: 'user',
          content: 'original',
          createdAt: 3,
          attachments: [{ path: '/workspace/attachments/a.txt', name: 'a.txt', mime: 'text/plain', size: 12 }],
        },
        { id: 'a2', role: 'assistant', content: 'old second', createdAt: 4, model: 'or-gemini-3-flash' },
      );
    });

    const branchId = chat.editAndResendFromMessage(id, 'u2', 'edited prompt');
    await flush(20);

    const original = chat.threads.find(t => t.id === id)!;
    const branch = chat.threads.find(t => t.id === branchId)!;
    expect(original.messages.map(m => m.content)).toEqual(['first', 'answer', 'original', 'old second']);
    expect(branch.messages.map(m => m.content)).toEqual(['first', 'answer', 'edited prompt', 'edited answer']);
    const edited = branch.messages[2];
    expect(edited.role === 'user' ? edited.attachments?.[0].path : undefined).toBe('/workspace/attachments/a.txt');
    expect(mock.calls).toHaveLength(1);
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
    expect(thread.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[1].content).toBe('Hello world');
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

  it('stores provider-reported OpenRouter usage cost on assistant messages', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'Hello' },
      {
        type: 'usage',
        usage: {
          providerId: 'openrouter',
          modelId: 'google/gemini-3-flash-preview',
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
    expect(threadLlmSpendUsd(chat.activeThread)).toBe(0.0042);
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
    chat.setThreadModel(id, 'or-gpt-5.5');
    profile.setDefaultSystemPrompt('z'.repeat(600_000));

    chat.sendMessage('hi');
    await flush(20);

    expect(mock.calls).toHaveLength(0);
    const reply = chat.activeThread!.messages.at(-1);
    expect(reply).toMatchObject({ role: 'assistant' });
    expect(reply?.content).toContain('too large');
    expect(chat.streamingMessageId).toBeNull();
  });

  it('compacts oversized prior tool results before retrying the original model request', async () => {
    const { chat, mock, providers } = setup([
      { type: 'text', delta: 'continued' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    chat.setThreadModel(id, 'or-gpt-5.5');
    const unavailableProvider: LlmProvider = {
      id: 'openrouter',
      ready: () => false,
      async *stream() { /* never called */ },
    };
    const router = providers.router as LlmRouter & {
      resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
    };
    router.resolve = (modelId: string) => {
      if (modelId === 'or-gpt-5.5') return { provider: mock, providerModelId: modelId };
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
    expect(chat.activeThread!.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'continued' });
    const compacted = chat.activeThread!.messages.find(m => m.id === 'a-big-context');
    if (compacted?.role !== 'assistant') throw new Error('expected assistant');
    expect(compacted.toolResults?.[0].content).toContain('[compacted tool result]');
    expect(compacted.toolResults?.[0].content).toContain('/workspace/artifacts/huge.json');
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
      if (modelId === 'or-gemini-3.1-flash-lite') return { provider: compactorProvider, providerModelId: 'google/gemini-3.1-flash-lite-preview' };
      if (modelId === chat.activeThread?.modelId) return { provider: mock, providerModelId: modelId };
      return { provider: unavailableProvider, providerModelId: modelId };
    };

    const id = chat.createThread();
    chat.setThreadModel(id, 'or-gpt-5.5');
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

    expect(compactModelIds).toEqual(['google/gemini-3.1-flash-lite-preview']);
    expect(mock.calls).toHaveLength(1);
    const compacted = chat.activeThread!.messages.find(m => m.id === 'a-cheap-compact');
    if (compacted?.role !== 'assistant') throw new Error('expected assistant');
    expect(compacted.toolResults?.[0].content).toContain('Model summary preserving /workspace/artifacts/huge.json');
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
    expect(reply.content.length).toBeGreaterThan(50);
    expect(reply.content).not.toContain('[interrupted]');
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
    expect(reply.content).toContain('[interrupted]');
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
    expect(replacement).toMatchObject({
      role: 'assistant',
      content: '',
      preTokenLabel: 'responding',
    });

    await flush(20);

    const messages = chat.activeThread!.messages;
    // user1, assistant1 (interrupted), user2, assistant2 (complete)
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'first' });
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('[interrupted]');
    expect(messages[2]).toMatchObject({ role: 'user', content: 'second' });
    expect(messages[3]).toMatchObject({ role: 'assistant', content: 'second-reply' });
    expect(chat.streamingMessageId).toBeNull();
    expect(mock.abortedAt).not.toBeNull();
  });

  it('does not append tool results that finish after the turn is interrupted', async () => {
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
    expect(assistant.role === 'assistant' ? assistant.toolCalls?.[0]?.name : undefined).toBe('slow_test_tool');

    chat.stopStreaming();
    (releaseTool as (() => void) | null)?.();
    await flush(10);

    expect(assistant.role === 'assistant' ? assistant.toolResults : undefined).toBeUndefined();
    expect(assistant.content).toContain('[no response]');
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
    expect(reply.content).toBe('*[no response]*');
  });

  it('persists snapshot to localStorage and restores on reload', async () => {
    const { chat } = setup([
      { type: 'text', delta: 'persisted' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const id = chat.createThread();
    chat.sendMessage('save me');
    await flush(20);
    // ChatStore throttles snapshot writes to ~250ms; wait wall-clock for
    // the trailing flush before re-reading from localStorage.
    await new Promise(resolve => setTimeout(resolve, 320));

    // Build a brand-new store; it should pick up the snapshot.
    const registry2 = new ModelRegistry();
    const providers2 = new ProviderStore(registry2);
    const profile2 = new UserProfileStore();
    const mock2 = new MockProvider();
    installMockProvider(providers2, mock2);
    const chat2 = new ChatStore(providers2, registry2, profile2);

    const restored = chat2.threads.find(t => t.id === id);
    expect(restored).toBeDefined();
    expect(restored!.messages.map(m => m.content)).toEqual(['save me', 'persisted']);
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

  it('can send local Ollama turns in micro mode with tiny prompt, fs only, and small output reserve', async () => {
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
    expect(mock.calls[0].tools?.map(tool => tool.name)).toEqual(['fs']);
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
    expect(mock.calls[0].tools?.map(tool => tool.name)).toEqual(['fs']);
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
    expect(assistant?.role === 'assistant' ? assistant.toolCalls?.[0] : undefined).toEqual(expect.objectContaining({
      name: 'fs',
      arguments: expect.objectContaining({ action: 'write', path: '/workspace/game.html' }),
    }));
    expect(assistant?.content).toBe('Created the game file.');
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
    expect(chat.activeThread!.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('I queued an image through local ComfyUI'),
    });
  });

  it('posts an image completion follow-up to the originating thread even after switching threads', () => {
    const { chat } = setup();
    const imageThreadId = chat.createThread();
    const otherThreadId = chat.createThread();

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
    const followUp = imageThread.messages.at(-1);
    expect(followUp).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('Here it is'),
    });
    expect(followUp?.role === 'assistant' ? followUp.toolResults?.[0].artifacts : undefined).toBeUndefined();
  });

  it('deduplicates the same image terminal event but allows later retry events', () => {
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

    const assistantFollowUps = chat.threads
      .find(t => t.id === threadId)!
      .messages
      .filter(m => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'image_generate_complete');
    expect(assistantFollowUps).toHaveLength(2);
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

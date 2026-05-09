import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { LlmProvider, LlmRequest } from '../../src/core/llm';
import type { LlmRouter } from '../../src/services/llm/router';
import type { ToolContext } from '../../src/services/tools/types';
import { MockProvider, flush, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';

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

  it('repairs a live unresolved active model before sending', () => {
    const { chat } = setup();
    chat.setThreadModel(chat.activeThreadId!, 'missing-model');

    chat.sendMessage('hello');

    expect(chat.activeThread?.modelId).toBe('or-gemini-3-flash');
  });

  it('createThread inserts a new thread at the top and selects it', () => {
    const { chat } = setup();
    const before = chat.threads.length;
    const id = chat.createThread();
    expect(chat.threads).toHaveLength(before + 1);
    expect(chat.threads[0].id).toBe(id);
    expect(chat.activeThreadId).toBe(id);
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
    chat.sendMessage('hi');
    await flush(20);
    const llamaCall = mock.calls.find(c => c.modelId === 'ollama-llama3.1');
    expect(llamaCall).toBeDefined();
    expect(Array.isArray(llamaCall!.tools)).toBe(true);
    expect((llamaCall!.tools ?? []).length).toBeGreaterThan(0);
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
      content: 'Sent straight to ComfyUI.',
    });
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

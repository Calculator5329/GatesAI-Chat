import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { ChatStore, MAX_CONCURRENT_AGENT_TASKS } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { LlmChunk, LlmProvider, LlmRequest } from '../../src/core/llm';
import type { ChatSnapshot } from '../../src/core/types';
import { saveSnapshot } from '../../src/services/persistence';
import { AGENT_TASK_SYSTEM_PROMPT_PREFIX } from '../../src/services/chat/agentTasks';
import { installMockProvider, flush } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';
import { messageText } from '../../src/core/messageParts';

class AgentTaskProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly calls: LlmRequest[] = [];
  originThreadId = '';
  agentMode: 'summary' | 'loop' = 'summary';
  holdAgent = false;
  private releaseAgents: Array<() => void> = [];

  ready(): boolean { return true; }

  release(): void {
    this.holdAgent = false;
    for (const release of this.releaseAgents.splice(0)) release();
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    const threadId = req.threadId ?? '';
    if (threadId === this.originThreadId) {
      const latestUser = [...req.messages].reverse().find(message => message.role === 'user')?.content ?? '';
      const hasSpawnResult = req.messages.some(message => message.role === 'tool' && message.toolName === 'spawn_task');
      if (!hasSpawnResult && /delegate/i.test(latestUser)) {
        yield {
          type: 'tool_call',
          call: {
            id: 'spawn-1',
            name: 'spawn_task',
            arguments: {
              title: 'Audit',
              instructions: 'Inspect the workspace and summarize findings.',
              model: 'missing-model',
            },
          },
        };
        yield { type: 'done', finishReason: 'tool_use' };
        return;
      }
      yield { type: 'text', delta: 'Origin turn complete.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    if (this.holdAgent) {
      await new Promise<void>(resolve => { this.releaseAgents.push(resolve); });
      if (signal.aborted) return;
    }

    if (this.agentMode === 'loop') {
      yield {
        type: 'tool_call',
        call: {
          id: `remember-${this.calls.filter(call => call.threadId === threadId).length}`,
          name: 'memory',
          arguments: { action: 'add', fact: 'agent loop' },
        },
      };
      yield { type: 'done', finishReason: 'tool_use' };
      return;
    }

    yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, costUsd: 0.001, costSource: 'provider' } };
    yield { type: 'text', delta: 'Agent summary: checked the workspace.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class InterleavedAgentProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly calls: LlmRequest[] = [];
  private waiters = new Map<string, (text: string) => void>();

  ready(): boolean { return true; }

  release(threadId: string, text: string): void {
    this.waiters.get(threadId)?.(text);
    this.waiters.delete(threadId);
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    const threadId = req.threadId ?? '';
    const text = await new Promise<string>(resolve => {
      this.waiters.set(threadId, resolve);
    });
    if (signal.aborted) return;
    yield { type: 'text', delta: text };
    yield { type: 'done', finishReason: 'stop' };
  }
}

function setup(options: { clear?: boolean } = {}) {
  if (options.clear ?? true) clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  providers.setKey('openrouter', 'test-key');
  const profile = new UserProfileStore();
  const provider = new AgentTaskProvider();
  installMockProvider(providers, provider);
  const chat = new ChatStore(providers, registry, profile);
  return { chat, provider };
}

function setupWithProvider<T extends LlmProvider>(provider: T, options: { clear?: boolean } = {}) {
  if (options.clear ?? true) clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  providers.setKey('openrouter', 'test-key');
  const profile = new UserProfileStore();
  installMockProvider(providers, provider);
  const chat = new ChatStore(providers, registry, profile);
  return { chat, provider };
}

function setupLocalAgentTask() {
  clearAppStorage();
  const registry = new ModelRegistry();
  registry.setDynamicForProvider('ollama', [{
    id: 'ollama-llama3.2:3b',
    name: 'llama3.2:3b',
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId: 'llama3.2:3b',
    dynamic: true,
    contextLength: 32_000,
  }]);
  const providers = new ProviderStore(registry, () => ({
    ollama: { baseUrl: 'http://127.0.0.1:11434', available: true, toolsEnabled: true },
  }));
  const profile = new UserProfileStore();
  const provider = new AgentTaskProvider();
  installMockProvider(providers, provider);
  const chat = new ChatStore(providers, registry, profile);
  return { chat, provider };
}

function seedOriginAssistant(chat: ChatStore, originThreadId: string): void {
  runInAction(() => {
    const origin = chat.threads.find(thread => thread.id === originThreadId)!;
    origin.messages.push({
      id: `assistant-${originThreadId}`,
      role: 'assistant',
      content: 'Started.',
      createdAt: Date.now(),
    });
  });
}

function completionEvents(chat: ChatStore, originThreadId: string) {
  const origin = chat.threads.find(thread => thread.id === originThreadId)!;
  return origin.messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.role === 'assistant' ? message.activityEvents ?? [] : [])
    .filter(event => event.kind === 'agent-task');
}

describe('agent task background turns', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('spawn_task creates a flagged thread, runs the normal loop, and posts a linked completion event', async () => {
    const { chat, provider } = setup();
    const originId = chat.createThread();
    provider.originThreadId = originId;

    chat.sendMessage('delegate this');
    await flush(120);

    const agent = chat.threads.find(thread => thread.agentTask);
    expect(agent).toBeDefined();
    expect(agent?.agentTaskOriginThreadId).toBe(originId);
    expect(agent?.title).toBe('Agent: Audit');
    expect(agent?.messages[0]?.role).toBe('user');
    expect(agent?.messages[0] && messageText(agent.messages[0])).toBe('Inspect the workspace and summarize findings.');
    expect(agent?.modelId).toBe(chat.threads.find(thread => thread.id === originId)?.modelId);
    expect(agent?.agentTaskStatus).toBe('done');
    expect(messageText(agent!.messages.find(message => message.role === 'assistant')!)).toContain('Agent summary');
    expect(agent?.messages.find(message => message.role === 'assistant')?.usage?.[0]?.totalTokens).toBe(14);

    const [event] = completionEvents(chat, originId);
    expect(event).toMatchObject({
      kind: 'agent-task',
      state: 'done',
      linkThreadId: agent?.id,
    });
    expect(event.summary).toContain('Agent summary');
  });

  it('keeps spawn_task advertised while slots remain and never advertises nesting', async () => {
    const { chat, provider } = setup();
    provider.holdAgent = true;
    const originId = chat.createThread();
    provider.originThreadId = originId;

    chat.sendMessage('delegate this');
    await flush(40);

    const originCalls = provider.calls.filter(call => call.threadId === originId);
    expect(originCalls[0].tools?.some(tool => tool.name === 'spawn_task')).toBe(true);
    expect(originCalls[0].tools?.find(tool => tool.name === 'spawn_task')?.description).toContain('0 of 3 slots in use');
    expect(originCalls[1].tools?.some(tool => tool.name === 'spawn_task')).toBe(true);
    expect(originCalls[1].tools?.find(tool => tool.name === 'spawn_task')?.description).toContain('1 of 3 slots in use');
    const agentCall = provider.calls.find(call => call.threadId !== originId);
    expect(agentCall?.tools?.some(tool => tool.name === 'spawn_task')).toBe(false);

    provider.release();
    await flush(80);

    chat.sendMessage('another normal turn');
    await flush(40);

    const laterOriginCall = provider.calls.filter(call => call.threadId === originId).at(-1);
    expect(laterOriginCall?.tools?.some(tool => tool.name === 'spawn_task')).toBe(true);
  });

  it('runs simultaneous fake-provider tasks independently and posts events to the right origins', async () => {
    const customProvider = new InterleavedAgentProvider();
    const { chat, provider } = setupWithProvider(customProvider);
    const originA = chat.createThread();
    const originB = chat.createThread();
    seedOriginAssistant(chat, originA);
    seedOriginAssistant(chat, originB);

    const taskA = chat.spawnTask({ title: 'A', instructions: 'Task A' }, originA);
    const taskB = chat.spawnTask({ title: 'B', instructions: 'Task B' }, originB);
    await flush(20);

    expect(taskA.ok).toBe(true);
    expect(taskB.ok).toBe(true);
    const agentA = chat.threads.find(thread => thread.id === taskA.threadId)!;
    const agentB = chat.threads.find(thread => thread.id === taskB.threadId)!;

    provider.release(agentB.id, 'Agent summary: B finished first.');
    await flush(40);

    expect(chat.threads.find(thread => thread.id === agentB.id)?.agentTaskStatus).toBe('done');
    expect(chat.threads.find(thread => thread.id === agentA.id)?.agentTaskStatus).toBe('running');
    expect(completionEvents(chat, originB)[0]).toMatchObject({ state: 'done', linkThreadId: agentB.id });
    expect(completionEvents(chat, originB)[0].summary).toContain('B finished first');
    expect(completionEvents(chat, originA)).toHaveLength(0);

    provider.release(agentA.id, 'Agent summary: A finished second.');
    await flush(40);

    expect(completionEvents(chat, originA)[0]).toMatchObject({ state: 'done', linkThreadId: agentA.id });
    expect(completionEvents(chat, originA)[0].summary).toContain('A finished second');
  });

  it('rejects a fourth immediate task while three run without creating a thread', async () => {
    const { chat, provider } = setup();
    provider.holdAgent = true;
    const originId = chat.createThread();
    seedOriginAssistant(chat, originId);

    const beforeCount = chat.threads.length;
    const started = Array.from({ length: MAX_CONCURRENT_AGENT_TASKS }, (_, index) =>
      chat.spawnTask({ title: `Task ${index + 1}`, instructions: `Hold ${index + 1}` }, originId)
    );
    const rejected = chat.spawnTask({ title: 'Task 4', instructions: 'Should not start' }, originId);

    expect(started.every(result => result.ok)).toBe(true);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('all 3 background task slots are in use');
    expect(chat.threads).toHaveLength(beforeCount + MAX_CONCURRENT_AGENT_TASKS);
    provider.release();
    await flush(80);
  });

  it('enforces the six-round agent cap and still posts a capped completion event', async () => {
    const { chat, provider } = setup();
    provider.agentMode = 'loop';
    const originId = chat.createThread();
    provider.originThreadId = originId;

    chat.sendMessage('delegate this');
    await flush(500);

    const agent = chat.threads.find(thread => thread.agentTask)!;
    expect(provider.calls.filter(call => call.threadId === agent.id)).toHaveLength(6);
    expect(messageText(agent.messages.find(message => message.role === 'assistant')!)).toContain('Stopped after 6 tool rounds');

    const [event] = completionEvents(chat, originId);
    expect(event.summary).toContain('[capped]');
    expect(event.summary).toContain('Stopped after 6 tool rounds');
  });

  it('clamps per-task rounds at ten and applies a capped system_prompt override after the non-interactive prefix', async () => {
    const { chat, provider } = setup();
    provider.agentMode = 'loop';
    const originId = chat.createThread();
    seedOriginAssistant(chat, originId);

    const longOverride = `${'Custom instructions. '.repeat(300)}TAIL`;
    const result = chat.spawnTask({
      title: 'Custom',
      instructions: 'Loop with custom prompt.',
      system_prompt: longOverride,
      max_rounds: 99,
    }, originId);
    await flush(800);

    const agent = chat.threads.find(thread => thread.id === result.threadId)!;
    const agentCalls = provider.calls.filter(call => call.threadId === agent.id);
    expect(agentCalls).toHaveLength(10);
    expect(messageText(agent.messages.find(message => message.role === 'assistant')!)).toContain('Stopped after 10 tool rounds');
    expect(agentCalls[0].systemPrompt).toContain(AGENT_TASK_SYSTEM_PROMPT_PREFIX);
    expect(agentCalls[0].systemPrompt).toContain('Custom instructions.');
    expect(agentCalls[0].systemPrompt?.length).toBeLessThanOrEqual(AGENT_TASK_SYSTEM_PROMPT_PREFIX.length + 2 + 4000);
  });

  it('creates delayed tasks as scheduled and starts them when due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const { chat, provider } = setup();
      const originId = chat.createThread();
      seedOriginAssistant(chat, originId);

      const result = chat.spawnTask({
        title: 'Later',
        instructions: 'Start later.',
        start_delay_minutes: 5,
      }, originId);

      const agent = chat.threads.find(thread => thread.id === result.threadId)!;
      expect(result.message).toContain('scheduled to start at 2026-01-01T00:05:00.000Z');
      expect(agent.agentTaskStatus).toBe('scheduled');
      expect(agent.agentTaskScheduledStartAt).toBe(Date.parse('2026-01-01T00:05:00.000Z'));
      expect(provider.calls.filter(call => call.threadId === agent.id)).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flush(80);

      expect(chat.threads.find(thread => thread.id === agent.id)?.agentTaskStatus).toBe('done');
      expect(completionEvents(chat, originId)[0]).toMatchObject({ state: 'done', linkThreadId: agent.id });
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts overdue scheduled tasks on boot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
    try {
      const snapshot: ChatSnapshot = {
        threads: [
          {
            id: 'agent',
            title: 'Agent: Overdue',
            subtitle: '',
            createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
            updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
            pinned: false,
            modelId: 'or-gpt-5.4-mini',
            messages: [{ id: 'u-agent', role: 'user', content: 'Run overdue.', createdAt: 1 }],
            agentTask: true,
            agentTaskOriginThreadId: 'origin',
            agentTaskStatus: 'scheduled',
            agentTaskScheduledStartAt: Date.parse('2026-01-01T00:05:00.000Z'),
          },
          {
            id: 'origin',
            title: 'Origin',
            subtitle: '',
            createdAt: 1,
            updatedAt: 2,
            pinned: false,
            modelId: 'or-gpt-5.4-mini',
            messages: [{ id: 'a-origin', role: 'assistant', content: 'Started.', createdAt: 3 }],
          },
        ],
        activeThreadId: 'origin',
      };
      saveSnapshot(snapshot);

      const { chat } = setup({ clear: false });
      await vi.advanceTimersByTimeAsync(0);
      await flush(80);

      expect(chat.threads.find(thread => thread.id === 'agent')?.agentTaskStatus).toBe('done');
      expect(completionEvents(chat, 'origin')[0]).toMatchObject({ state: 'done', linkThreadId: 'agent' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms future scheduled tasks on boot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const snapshot: ChatSnapshot = {
        threads: [
          {
            id: 'agent',
            title: 'Agent: Future',
            subtitle: '',
            createdAt: 1,
            updatedAt: 2,
            pinned: false,
            modelId: 'or-gpt-5.4-mini',
            messages: [{ id: 'u-agent', role: 'user', content: 'Run later.', createdAt: 1 }],
            agentTask: true,
            agentTaskOriginThreadId: 'origin',
            agentTaskStatus: 'scheduled',
            agentTaskScheduledStartAt: Date.parse('2026-01-01T00:03:00.000Z'),
          },
          {
            id: 'origin',
            title: 'Origin',
            subtitle: '',
            createdAt: 1,
            updatedAt: 2,
            pinned: false,
            modelId: 'or-gpt-5.4-mini',
            messages: [{ id: 'a-origin', role: 'assistant', content: 'Started.', createdAt: 3 }],
          },
        ],
        activeThreadId: 'origin',
      };
      saveSnapshot(snapshot);

      const { chat, provider } = setup({ clear: false });
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 59_000);
      await flush(20);
      expect(chat.threads.find(thread => thread.id === 'agent')?.agentTaskStatus).toBe('scheduled');
      expect(provider.calls.filter(call => call.threadId === 'agent')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      await flush(80);
      expect(chat.threads.find(thread => thread.id === 'agent')?.agentTaskStatus).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending delayed start when the task thread is deleted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const { chat, provider } = setup();
      const originId = chat.createThread();
      seedOriginAssistant(chat, originId);
      const result = chat.spawnTask({ title: 'Cancel me', instructions: 'Do not start.', start_delay_minutes: 2 }, originId);
      const agentId = result.threadId!;

      chat.softDeleteThread(agentId);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await flush(40);

      expect(provider.calls.filter(call => call.threadId === agentId)).toHaveLength(0);
      expect(completionEvents(chat, originId)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers a due scheduled task while all slots are busy and starts it when a slot frees', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const { chat, provider } = setup();
      provider.holdAgent = true;
      const originId = chat.createThread();
      seedOriginAssistant(chat, originId);
      const running = Array.from({ length: MAX_CONCURRENT_AGENT_TASKS }, (_, index) =>
        chat.spawnTask({ title: `Busy ${index + 1}`, instructions: `Hold ${index + 1}` }, originId)
      );
      const delayed = chat.spawnTask({ title: 'Queued', instructions: 'Wait for a slot.', start_delay_minutes: 1 }, originId);
      const delayedId = delayed.threadId!;
      await flush(40);

      await vi.advanceTimersByTimeAsync(60_000);
      await flush(40);

      expect(running.every(result => result.ok)).toBe(true);
      expect(chat.threads.find(thread => thread.id === delayedId)?.agentTaskStatus).toBe('scheduled');
      expect(provider.calls.filter(call => call.threadId === delayedId)).toHaveLength(0);

      provider.release();
      await flush(120);

      expect(provider.calls.filter(call => call.threadId === delayedId)).toHaveLength(1);
      expect(chat.threads.find(thread => thread.id === delayedId)?.agentTaskStatus).toBe('done');
      expect(completionEvents(chat, originId).some(event => event.linkThreadId === delayedId)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the normal stop control abort an opened agent task thread', async () => {
    const { chat, provider } = setup();
    provider.holdAgent = true;
    const originId = chat.createThread();
    provider.originThreadId = originId;

    chat.sendMessage('delegate this');
    await flush(40);
    const agent = chat.threads.find(thread => thread.agentTask)!;

    chat.selectThread(agent.id);
    chat.stopStreaming();
    provider.release();
    await flush(40);

    expect(chat.threads.find(thread => thread.id === agent.id)?.agentTaskStatus).toBe('interrupted');
    expect(completionEvents(chat, originId)[0]).toMatchObject({ state: 'cancelled', linkThreadId: agent.id });
  });

  it('finalizes a dangling running agent task as interrupted on boot', () => {
    const originThread = {
      id: 'origin',
      title: 'Origin',
      subtitle: '',
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      modelId: 'or-gpt-5.4-mini',
      messages: [{ id: 'a-origin', role: 'assistant' as const, content: 'Started.', createdAt: 3 }],
    };
    const snapshot: ChatSnapshot = {
      threads: [
        {
          id: 'agent',
          title: 'Agent: Audit',
          subtitle: '',
          createdAt: 4,
          updatedAt: 5,
          pinned: false,
          modelId: 'or-gpt-5.4-mini',
          messages: [{ id: 'a-agent', role: 'assistant' as const, content: '', createdAt: 6 }],
          agentTask: true,
          agentTaskOriginThreadId: 'origin',
          agentTaskStatus: 'running',
        },
        originThread,
      ],
      activeThreadId: 'origin',
    };
    saveSnapshot(snapshot);

    const { chat } = setup({ clear: false });

    expect(chat.threads.find(thread => thread.id === 'agent')?.agentTaskStatus).toBe('interrupted');
    expect(messageText(chat.threads.find(thread => thread.id === 'agent')!.messages[0])).toContain('interrupted');
    expect(completionEvents(chat, 'origin')[0]).toMatchObject({ state: 'cancelled', linkThreadId: 'agent' });
  });

  it('round-trips agent task flags and exposes sidebar grouping selectors', () => {
    const snapshot: ChatSnapshot = {
      threads: [
        {
          id: 'agent',
          title: 'Agent: Audit',
          subtitle: '',
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          modelId: 'or-gpt-5.4-mini',
          messages: [],
          agentTask: true,
          agentTaskOriginThreadId: 'origin',
          agentTaskStatus: 'done',
        },
        {
          id: 'origin',
          title: 'Origin',
          subtitle: '',
          createdAt: 3,
          updatedAt: 4,
          pinned: false,
          modelId: 'or-gpt-5.4-mini',
          messages: [],
        },
      ],
      activeThreadId: 'origin',
    };
    saveSnapshot(snapshot);

    const { chat } = setup({ clear: false });

    expect(chat.threads.find(thread => thread.id === 'agent')).toMatchObject({
      agentTask: true,
      agentTaskOriginThreadId: 'origin',
      agentTaskStatus: 'done',
    });
    expect(chat.visibleAgentTaskThreads.map(thread => thread.id)).toEqual(['agent']);
    expect(chat.visibleConversationThreads.map(thread => thread.id)).toEqual(['origin']);
  });

  it('falls back to a local model for sub-agent tasks when keyless Ollama is online', async () => {
    const { chat, provider } = setupLocalAgentTask();
    const originId = chat.createThread();
    seedOriginAssistant(chat, originId);

    const result = chat.spawnTask({ title: 'Local', instructions: 'Run locally.' }, originId);
    await flush(80);

    const agent = chat.threads.find(thread => thread.id === result.threadId)!;
    expect(result.ok).toBe(true);
    expect(agent.modelId).toBe('ollama-llama3.2:3b');
    expect(provider.calls.find(call => call.threadId === agent.id)?.modelId).toBe('ollama-llama3.2:3b');
  });

  it('does not create a sub-agent task when no cloud key or local model is available', () => {
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const chat = new ChatStore(providers, registry, new UserProfileStore());
    const originId = chat.createThread();
    const before = chat.threads.length;

    const result = chat.spawnTask({ title: 'No provider', instructions: 'Cannot run.' }, originId);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('no local or cloud chat model');
    expect(chat.threads).toHaveLength(before);
  });
});

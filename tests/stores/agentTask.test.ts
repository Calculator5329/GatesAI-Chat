import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { LlmChunk, LlmProvider, LlmRequest } from '../../src/core/llm';
import type { ChatSnapshot } from '../../src/core/types';
import { saveSnapshot } from '../../src/services/persistence';
import { installMockProvider, flush } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';

class AgentTaskProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly calls: LlmRequest[] = [];
  originThreadId = '';
  agentMode: 'summary' | 'loop' = 'summary';
  holdAgent = false;
  private releaseAgent: (() => void) | null = null;

  ready(): boolean { return true; }

  release(): void {
    this.holdAgent = false;
    this.releaseAgent?.();
    this.releaseAgent = null;
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
      await new Promise<void>(resolve => { this.releaseAgent = resolve; });
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

function setup(options: { clear?: boolean } = {}) {
  if (options.clear ?? true) clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const provider = new AgentTaskProvider();
  installMockProvider(providers, provider);
  const chat = new ChatStore(providers, registry, profile);
  return { chat, provider };
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
    expect(agent?.messages[0]).toMatchObject({ role: 'user', content: 'Inspect the workspace and summarize findings.' });
    expect(agent?.modelId).toBe(chat.threads.find(thread => thread.id === originId)?.modelId);
    expect(agent?.agentTaskStatus).toBe('done');
    expect(agent?.messages.find(message => message.role === 'assistant')?.content).toContain('Agent summary');
    expect(agent?.messages.find(message => message.role === 'assistant')?.usage?.[0]?.totalTokens).toBe(14);

    const [event] = completionEvents(chat, originId);
    expect(event).toMatchObject({
      kind: 'agent-task',
      state: 'done',
      linkThreadId: agent?.id,
    });
    expect(event.summary).toContain('Agent summary');
  });

  it('gates spawn_task while a task runs, restores it after completion, and never advertises nesting', async () => {
    const { chat, provider } = setup();
    provider.holdAgent = true;
    const originId = chat.createThread();
    provider.originThreadId = originId;

    chat.sendMessage('delegate this');
    await flush(40);

    const originCalls = provider.calls.filter(call => call.threadId === originId);
    expect(originCalls[0].tools?.some(tool => tool.name === 'spawn_task')).toBe(true);
    expect(originCalls[1].tools?.some(tool => tool.name === 'spawn_task')).toBe(false);
    const agentCall = provider.calls.find(call => call.threadId !== originId);
    expect(agentCall?.tools?.some(tool => tool.name === 'spawn_task')).toBe(false);

    provider.release();
    await flush(80);

    chat.sendMessage('another normal turn');
    await flush(40);

    const laterOriginCall = provider.calls.filter(call => call.threadId === originId).at(-1);
    expect(laterOriginCall?.tools?.some(tool => tool.name === 'spawn_task')).toBe(true);
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
    expect(agent.messages.find(message => message.role === 'assistant')?.content).toContain('Stopped after 6 tool rounds');

    const [event] = completionEvents(chat, originId);
    expect(event.summary).toContain('[capped]');
    expect(event.summary).toContain('Stopped after 6 tool rounds');
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
    expect(chat.threads.find(thread => thread.id === 'agent')?.messages[0].content).toContain('interrupted');
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
});

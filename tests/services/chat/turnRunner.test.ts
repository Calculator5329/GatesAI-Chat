import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LlmChunk, LlmProvider, LlmRequest, ProviderId } from '../../../src/core/llm';
import type { AssistantMessage, StreamActivity, Thread, ToolResult } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import {
  TurnRunner,
  type TurnHost,
} from '../../../src/services/chat/turnRunner';
import type { StreamingRoundActivityUpdate } from '../../../src/services/chat/streamingRoundExecutor';
import { clearAppStorage } from '../../helpers/storage';

class ScriptedProvider implements LlmProvider {
  readonly id: ProviderId = 'openrouter';
  readonly calls: LlmRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: LlmChunk[][]) {}

  ready(): boolean { return true; }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    const chunks = this.script[this.cursor++] ?? [{ type: 'done', finishReason: 'stop' }];
    for (const chunk of chunks) {
      if (signal.aborted) return;
      await Promise.resolve();
      yield chunk;
    }
  }
}

class FakeTurnHost implements TurnHost {
  readonly errors: Record<string, string> = {};
  readonly phases: StreamActivity['phase'][] = [];
  autoNameCalls = 0;
  streamingByThread: Record<string, string> = {};

  constructor(readonly threads: Thread[]) {}

  getThread(threadId: string): Thread | undefined {
    return this.threads.find(thread => thread.id === threadId);
  }

  appendAssistantMessage(threadId: string, message: AssistantMessage): void {
    this.getThread(threadId)?.messages.push(message);
    this.streamingByThread[threadId] = message.id;
  }

  ownsTurn(threadId: string, messageId: string): boolean {
    return this.streamingByThread[threadId] === messageId;
  }

  queueTextChunk(threadId: string, messageId: string, chunk: string): void {
    const message = this.getAssistant(threadId, messageId);
    if (message) message.content += chunk;
  }

  flushText(): void {}

  cancelText(): void {}

  clearStreamingState(threadId: string, messageId: string): void {
    if (this.streamingByThread[threadId] === messageId) delete this.streamingByThread[threadId];
  }

  applyRoundActivityUpdate(_threadId: string, _messageId: string, update: StreamingRoundActivityUpdate): void {
    this.phases.push(update.phase);
  }

  markStreamActivityPhase(_threadId: string, _messageId: string, phase: StreamActivity['phase']): void {
    this.phases.push(phase);
  }

  updateAssistantMessage(
    threadId: string,
    messageId: string,
    updater: (message: AssistantMessage) => void,
    options?: { touch?: boolean },
  ): AssistantMessage | undefined {
    const message = this.getAssistant(threadId, messageId);
    if (!message) return undefined;
    updater(message);
    if (options?.touch) message.createdAt = Date.now();
    return message;
  }

  replaceToolResultContent(result: ToolResult, content: string): void {
    result.content = content;
  }

  setThreadLastError(threadId: string, message: string | null): void {
    if (!message) delete this.errors[threadId];
    else this.errors[threadId] = message;
  }

  maybeAutoName(): void {
    this.autoNameCalls += 1;
  }

  private getAssistant(threadId: string, messageId: string): AssistantMessage | undefined {
    const message = this.getThread(threadId)?.messages.find(item => item.id === messageId);
    return message?.role === 'assistant' ? message : undefined;
  }
}

function makeThread(): Thread {
  return {
    id: 'thread-1',
    title: 'New conversation',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [{ id: 'user-1', role: 'user', content: 'remember jazz piano', createdAt: 2 }],
  };
}

function setup(script: LlmChunk[][]) {
  const registry = new ModelRegistry();
  const profile = new UserProfileStore();
  const provider = new ScriptedProvider(script);
  const host = new FakeTurnHost([makeThread()]);
  let id = 0;
  const runner = new TurnRunner({
    host,
    router: {
      resolve: () => ({ provider, providerModelId: 'google/gemini-3-flash' }),
    },
    registry,
    profile,
    chat: {
      threads: host.threads,
      selectThread: () => true,
      renameThread: () => {},
      setThreadContext: () => {},
      llmComplete: async () => '',
    },
    createId: prefix => `${prefix}-${++id}`,
    getToolStores: () => undefined,
    getRecentSummaries: () => [],
  });
  return { runner, host, provider, profile, thread: host.threads[0] };
}

describe('TurnRunner', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('keeps a multi-round tool turn on one assistant message', async () => {
    const { runner, host, provider, profile, thread } = setup([
      [
        { type: 'text', delta: "I'll remember that." },
        { type: 'tool_call', call: { id: 'memory-1', name: 'memory', arguments: { action: 'add', fact: 'User likes jazz piano' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [
        { type: 'text', delta: 'Saved.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    await runner.run(thread.id, new AbortController().signal);

    expect(thread.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    const assistant = thread.messages[1];
    expect(assistant.role).toBe('assistant');
    if (assistant.role !== 'assistant') return;
    expect(assistant.workNotes?.[0]).toContain("I'll remember that");
    expect(assistant.content).toBe('Saved.');
    expect(assistant.toolCalls?.map(call => call.id)).toEqual(['memory-1']);
    expect(assistant.toolResults?.[0].content).toContain('Saved');
    expect(profile.facts).toContain('User likes jazz piano');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages.some(message => message.role === 'tool')).toBe(true);
    expect(host.streamingByThread[thread.id]).toBeUndefined();
    expect(host.autoNameCalls).toBe(1);
  });

  it('retries an empty length-limited final round after tool progress', async () => {
    const { runner, provider, thread } = setup([
      [
        { type: 'tool_call', call: { id: 'memory-1', name: 'memory', arguments: { action: 'add', fact: 'Wrote game artifact' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'done', finishReason: 'length' }],
      [
        { type: 'text', delta: 'Done - artifact ready.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    await runner.run(thread.id, new AbortController().signal);

    expect(provider.calls).toHaveLength(3);
    const assistant = thread.messages[1];
    expect(assistant.role).toBe('assistant');
    if (assistant.role !== 'assistant') return;
    expect(assistant.content).toBe('Done - artifact ready.');
    expect(assistant.finishReason).toBe('stop');
  });
});

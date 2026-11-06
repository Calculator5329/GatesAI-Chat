import { describe, expect, it, vi } from 'vitest';
import { ChatTurnEngine, type ChatTurnEngineHost } from '../../../src/services/chat/chatTurnEngine';
import type { StreamActivity, Thread } from '../../../src/core/types';
import type { TurnRunner } from '../../../src/services/chat/turnRunner';

function makeThread(): Thread {
  return {
    id: 't1',
    title: 'Chat',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-test',
    messages: [],
  };
}

describe('ChatTurnEngine', () => {
  it('appends a user message and starts a turn', async () => {
    const thread = makeThread();
    const streaming: Record<string, string> = {};
    const activity: Record<string, StreamActivity> = {};
    const run = vi.fn(async () => undefined);
    const host: ChatTurnEngineHost = {
      runInAction: fn => fn(),
      newMessageId: () => 'm-user',
      ensureThreadModel: () => thread,
      findMessage: (threadId, messageId) =>
        threadId === thread.id ? thread.messages.find(message => message.id === messageId) : undefined,
      appendMessage: (_threadId, message) => { thread.messages.push(message); },
      setActiveThreadId: vi.fn(),
      setThreadLastError: vi.fn(),
      getStreamingMessageId: threadId => streaming[threadId],
      setStreamingMessageId: (threadId, messageId) => {
        if (messageId === undefined) delete streaming[threadId];
        else streaming[threadId] = messageId;
      },
      getStreamActivity: threadId => activity[threadId],
      setStreamActivity: (threadId, next) => {
        if (next === undefined) delete activity[threadId];
        else activity[threadId] = next;
      },
      appendChunk: vi.fn(),
    };
    const engine = new ChatTurnEngine({
      host,
      turnRunner: { run } as unknown as TurnRunner,
    });

    engine.sendMessageToHydratedThread(thread.id, 'hello');

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.role).toBe('user');
    expect(run).toHaveBeenCalledOnce();
  });

  it('coalesces reasoning chunks into one store update per frame, and a retry drops the stale ones (review F8)', () => {
    const activity: Record<string, StreamActivity> = {
      t1: { messageId: 'm-a', phase: 'streaming', startedAt: 1, lastProviderAt: 1, round: 0 } as StreamActivity,
    };
    const frames: Array<() => void> = [];
    const setStreamActivity = vi.fn((threadId: string, next: StreamActivity | undefined) => {
      if (next === undefined) delete activity[threadId];
      else activity[threadId] = next;
    });
    const host: ChatTurnEngineHost = {
      runInAction: fn => fn(),
      newMessageId: () => 'm',
      ensureThreadModel: () => makeThread(),
      findMessage: () => undefined,
      appendMessage: vi.fn(),
      setActiveThreadId: vi.fn(),
      setThreadLastError: vi.fn(),
      getStreamingMessageId: () => 'm-a',
      setStreamingMessageId: vi.fn(),
      getStreamActivity: threadId => activity[threadId],
      setStreamActivity,
      appendChunk: vi.fn(),
    };
    const engine = new ChatTurnEngine({
      host,
      turnRunner: { run: vi.fn() } as unknown as TurnRunner,
      scheduleFlush: flush => { frames.push(flush); },
    });

    for (const token of ['Light', ' scatters', ' off', ' air', '.']) engine.appendStreamReasoning('t1', 'm-a', token);
    expect(setStreamActivity).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(setStreamActivity).toHaveBeenCalledTimes(1);
    expect(activity.t1?.reasoning).toBe('Light scatters off air.');

    // Reasoning still waiting for its frame when a retry reconnects is dropped.
    engine.appendStreamReasoning('t1', 'm-a', ' stale');
    engine.applyRoundActivityUpdate('t1', 'm-a', { phase: 'connecting', at: 2, round: 0, providerId: 'ollama', providerModelId: 'gemma4:12b' });
    for (const frame of frames.splice(0)) frame();
    expect(activity.t1).toMatchObject({ phase: 'connecting' });
    expect(activity.t1?.reasoning).toBeUndefined();
  });

  it('ignores empty sends', () => {
    const run = vi.fn(async () => undefined);
    const host: ChatTurnEngineHost = {
      runInAction: fn => fn(),
      newMessageId: () => 'm',
      ensureThreadModel: () => makeThread(),
      findMessage: () => undefined,
      appendMessage: vi.fn(),
      setActiveThreadId: vi.fn(),
      setThreadLastError: vi.fn(),
      getStreamingMessageId: () => undefined,
      setStreamingMessageId: vi.fn(),
      getStreamActivity: () => undefined,
      setStreamActivity: vi.fn(),
      appendChunk: vi.fn(),
    };
    const engine = new ChatTurnEngine({
      host,
      turnRunner: { run } as unknown as TurnRunner,
    });
    engine.sendMessageToHydratedThread('t1', '   ');
    expect(run).not.toHaveBeenCalled();
    expect(host.appendMessage).not.toHaveBeenCalled();
  });
});

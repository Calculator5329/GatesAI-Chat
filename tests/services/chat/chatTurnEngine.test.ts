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

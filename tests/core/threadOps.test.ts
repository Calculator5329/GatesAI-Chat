import { describe, expect, it } from 'vitest';
import type { Thread } from '../../src/core/types';
import { messageAttachments, messageText, messageToolResults } from '../../src/core/messageParts';
import {
  branchThreadFrom,
  createEmptyThread,
  editUserMessageAndTruncate,
  normalizeActiveThreadId,
  regenerateThreadFromAssistant,
  renameThread,
  restoreThread,
  softDeleteThread,
  toggleThreadPinned,
} from '../../src/core/threadOps';

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't-1',
    title: 'Source',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-gemini-3-flash',
    messages: [],
    ...overrides,
  };
}

describe('threadOps', () => {
  it('creates an empty thread from explicit id/time and normalizes active ids to visible threads', () => {
    const empty = createEmptyThread('new-thread', 42);
    expect(empty).toMatchObject({
      id: 'new-thread',
      title: 'New conversation',
      createdAt: 42,
      updatedAt: 42,
      pinned: false,
      messages: [],
    });

    expect(normalizeActiveThreadId([
      thread({ id: 'deleted', updatedAt: 20, deletedAt: 21 }),
      thread({ id: 'visible-old', updatedAt: 10 }),
      thread({ id: 'visible-new', updatedAt: 30 }),
    ], 'missing')).toBe('visible-new');
  });

  it('validates rename, pin, restore, and soft-delete transitions without mutating inputs', () => {
    const source = thread({ pinned: false });
    expect(renameThread(source, '   ', 10)).toMatchObject({
      title: 'Untitled conversation',
      autoNamed: true,
      updatedAt: 10,
    });
    expect(toggleThreadPinned(source, 11)).toMatchObject({ pinned: true, updatedAt: 11 });

    const deleted = thread({ deletedAt: 5 });
    expect(restoreThread(deleted, 12)).toMatchObject({ id: deleted.id, updatedAt: 12 });
    expect(restoreThread(deleted, 12)?.deletedAt).toBeUndefined();
    expect(deleted.deletedAt).toBe(5);

    const fallback = createEmptyThread('fallback', 20);
    const result = softDeleteThread([source], {
      threadId: source.id,
      activeThreadId: source.id,
      now: 20,
      fallbackThread: fallback,
    });
    expect(result.activeThreadId).toBe('fallback');
    expect(result.threads.map(item => item.id)).toEqual(['fallback', source.id]);
    expect(result.threads[1].deletedAt).toBe(20);
    expect(source.deletedAt).toBeUndefined();
  });

  it('branches through the target message with fresh ids and deep-copied tool metadata', () => {
    const source = thread({
      title: 'Research',
      pinned: true,
      autoNamed: true,
      contextMode: 'system-tools',
      thinkingEffort: 'high',
      threadContext: 'do not copy',
      messages: [
        { id: 'u1', role: 'user', content: 'one', createdAt: 1 },
        {
          id: 'a1',
          role: 'assistant',
          content: 'two',
          createdAt: 2,
          model: 'or-gpt-5.5',
          toolCalls: [{ id: 'call-1', name: 'fs', arguments: { action: 'read', path: '/workspace/a.txt' } }],
          toolResults: [{ toolCallId: 'call-1', toolName: 'fs', content: 'result', ranAt: 3 }],
          activityEvents: [{ id: 'evt-1', kind: 'bridge', state: 'done', verb: 'Workspace online', startedAt: 4 }],
        },
        { id: 'u2', role: 'user', content: 'three', createdAt: 5 },
      ],
    });

    const branch = branchThreadFrom(source, { messageId: 'a1', newThreadId: 'branch-1', now: 100 });

    expect(branch).toBeDefined();
    expect(branch?.title).toBe('Research (branch)');
    expect(branch?.pinned).toBe(false);
    expect(branch?.autoNamed).toBeUndefined();
    expect(branch?.contextMode).toBe('system-tools');
    expect(branch?.thinkingEffort).toBe('high');
    expect(branch?.threadContext).toBeUndefined();
    expect(branch?.messages.map(messageText)).toEqual(['one', 'two']);
    expect(branch?.messages.map(message => message.id)).toEqual(['branch-1-m-0', 'branch-1-m-1']);
    const copiedAssistant = branch?.messages[1];
    expect(copiedAssistant?.role === 'assistant' ? messageToolResults(copiedAssistant)[0].content : undefined).toBe('result');
    if (copiedAssistant?.role === 'assistant') {
      messageToolResults(copiedAssistant)[0].content = 'changed';
    }
    const sourceAssistant = source.messages[1];
    expect(sourceAssistant.role === 'assistant' ? messageToolResults(sourceAssistant)[0].content : undefined).toBe('result');
    expect(copiedAssistant?.role === 'assistant' ? copiedAssistant.activityEvents : undefined).toBeUndefined();
  });

  it('calculates edit/resend and regenerate truncation boundaries', () => {
    const source = thread({
      messages: [
        { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'first answer', createdAt: 2 },
        {
          id: 'u2',
          role: 'user',
          content: 'second',
          createdAt: 3,
          attachments: [{ id: 'att-1', path: '/workspace/a.txt', name: 'a.txt', mime: 'text/plain', size: 10 }],
        },
        { id: 'a2', role: 'assistant', content: 'second answer', createdAt: 4 },
        { id: 'u3', role: 'user', content: 'third', createdAt: 5 },
      ],
    });

    const edited = editUserMessageAndTruncate(source, 'u2', ' edited prompt ', 50);
    expect(edited?.messages.map(messageText)).toEqual(['first', 'first answer', 'edited prompt']);
    const editedUser = edited?.messages[2];
    expect(editedUser?.role === 'user' ? messageAttachments(editedUser)[0].path : undefined).toBe('/workspace/a.txt');
    expect(source.messages.map(message => message.content)).toContain('second answer');

    const regenerated = regenerateThreadFromAssistant(source, 'a2', 60);
    expect(regenerated?.messages.map(messageText)).toEqual(['first', 'first answer', 'second']);
    expect(regenerated?.updatedAt).toBe(60);
    expect(regenerateThreadFromAssistant(source, 'a1', 60)?.messages.map(message => message.content)).toEqual(['first']);
    expect(regenerateThreadFromAssistant(source, 'missing', 60)).toBeNull();
  });
});

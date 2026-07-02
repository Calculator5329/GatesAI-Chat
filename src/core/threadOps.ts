// Pure thread CRUD helpers used by ChatStore wrappers and direct unit tests.
// Called by stores; depends only on core chat types.
// Invariant: helpers return new thread/thread-list objects and never mutate inputs.
import type { AssistantMessage, Message, Thread } from './types';
import { DEFAULT_MODEL_ID } from './models';

export function createEmptyThread(id: string, now: number): Thread {
  return {
    id,
    title: 'New conversation',
    subtitle: '',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [],
  };
}

export function normalizeActiveThreadId(threads: Thread[], activeThreadId: string | null): string | null {
  if (activeThreadId && threads.some(thread => thread.id === activeThreadId && thread.deletedAt == null)) {
    return activeThreadId;
  }
  const visible = threads
    .filter(thread => thread.deletedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return visible[0]?.id ?? null;
}

export function renameThread(thread: Thread, title: string, now: number): Thread | null {
  if (thread.deletedAt != null) return null;
  const next = title.trim();
  return {
    ...thread,
    title: next || 'Untitled conversation',
    autoNamed: true,
    updatedAt: now,
  };
}

export function toggleThreadPinned(thread: Thread, now: number): Thread | null {
  if (thread.deletedAt != null) return null;
  return {
    ...thread,
    pinned: !thread.pinned,
    updatedAt: now,
  };
}

export function restoreThread(thread: Thread, now: number): Thread | null {
  if (thread.deletedAt == null) return null;
  const next = { ...thread, updatedAt: now };
  delete next.deletedAt;
  return next;
}

export interface SoftDeleteThreadResult {
  changed: boolean;
  threads: Thread[];
  activeThreadId: string | null;
}

export function softDeleteThread(
  threads: Thread[],
  args: {
    threadId: string;
    activeThreadId: string | null;
    now: number;
    fallbackThread?: Thread;
  },
): SoftDeleteThreadResult {
  const index = threads.findIndex(thread => thread.id === args.threadId);
  const thread = threads[index];
  if (!thread || thread.deletedAt != null) {
    return { changed: false, threads, activeThreadId: args.activeThreadId };
  }

  let nextThreads = threads.map((item, itemIndex) =>
    itemIndex === index ? { ...item, deletedAt: args.now, updatedAt: args.now } : item
  );
  let nextActiveThreadId = args.activeThreadId;
  if (args.activeThreadId === args.threadId) {
    const nextVisible = nextThreads.find(item => item.deletedAt == null);
    if (nextVisible) {
      nextActiveThreadId = nextVisible.id;
    } else if (args.fallbackThread) {
      nextThreads = [args.fallbackThread, ...nextThreads];
      nextActiveThreadId = args.fallbackThread.id;
    } else {
      nextActiveThreadId = null;
    }
  }
  return {
    changed: true,
    threads: nextThreads,
    activeThreadId: nextActiveThreadId,
  };
}

export function branchThreadFrom(
  source: Thread,
  args: { messageId: string; newThreadId: string; now: number },
): Thread | null {
  if (source.deletedAt != null) return null;
  const index = source.messages.findIndex(message => message.id === args.messageId);
  if (index < 0) return null;
  const messages = cloneMessagesForBranch(source.messages.slice(0, index + 1), args.newThreadId);
  return {
    id: args.newThreadId,
    title: branchTitle(source.title),
    subtitle: source.subtitle,
    createdAt: args.now,
    updatedAt: args.now,
    pinned: false,
    modelId: source.modelId,
    messages,
    ...(source.contextMode ? { contextMode: source.contextMode } : {}),
    ...(source.thinkingEffort ? { thinkingEffort: source.thinkingEffort } : {}),
  };
}

export function regenerateThreadFromAssistant(thread: Thread, messageId: string, now: number): Thread | null {
  if (thread.deletedAt != null) return null;
  const index = thread.messages.findIndex(message => message.id === messageId);
  const message = thread.messages[index];
  if (!message || message.role !== 'assistant') return null;
  if (findPrecedingUserIndex(thread.messages, index) < 0) return null;
  return {
    ...thread,
    messages: thread.messages.slice(0, index),
    updatedAt: now,
  };
}

export function editUserMessageAndTruncate(thread: Thread, messageId: string, text: string, now: number): Thread | null {
  if (thread.deletedAt != null) return null;
  const index = thread.messages.findIndex(message => message.id === messageId);
  const original = thread.messages[index];
  const trimmed = text.trim();
  if (!original || original.role !== 'user' || !trimmed) return null;
  return {
    ...thread,
    messages: [
      ...thread.messages.slice(0, index),
      { ...original, content: trimmed },
    ],
    updatedAt: now,
  };
}

export function findPrecedingUserIndex(messages: Message[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}

function cloneMessagesForBranch(messages: Message[], idSalt: string): Message[] {
  return messages.map((message, index) => {
    if (message.role === 'user') {
      return {
        id: `${idSalt}-m-${index}`,
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
        ...(message.attachments ? { attachments: message.attachments.map(attachment => ({ ...attachment })) } : {}),
      };
    }
    return {
      id: `${idSalt}-m-${index}`,
      role: 'assistant',
      content: message.content,
      createdAt: message.createdAt,
      ...(message.model ? { model: message.model } : {}),
      ...(message.workNotes ? { workNotes: [...message.workNotes] } : {}),
      ...(message.toolCalls ? { toolCalls: deepClone(message.toolCalls) as AssistantMessage['toolCalls'] } : {}),
      ...(message.toolResults ? { toolResults: deepClone(message.toolResults) as AssistantMessage['toolResults'] } : {}),
      ...(message.usage ? { usage: deepClone(message.usage) as AssistantMessage['usage'] } : {}),
      ...(message.finishReason ? { finishReason: message.finishReason } : {}),
    };
  });
}

function branchTitle(title: string): string {
  const base = title.trim() || 'Untitled conversation';
  return base.endsWith(' (branch)') ? base : `${base} (branch)`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

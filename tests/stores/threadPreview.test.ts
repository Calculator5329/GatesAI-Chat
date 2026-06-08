import { describe, expect, it } from 'vitest';
import { threadMatchesSearch, threadSidebarPreview } from '../../src/stores/ChatStore';
import type { Message, Thread } from '../../src/core/types';

function msg(role: 'user' | 'assistant', content: string, id = 'm'): Message {
  return { id, role, content, createdAt: 1 } as Message;
}

function thread(messages: Message[], extra: Partial<Thread> = {}): Thread {
  return {
    id: 't',
    title: 'Untitled',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-gemini-3-flash',
    messages,
    ...extra,
  };
}

describe('threadSidebarPreview', () => {
  it('returns empty string for a thread with no messages', () => {
    expect(threadSidebarPreview(thread([]))).toBe('');
  });

  it('derives the preview from the most recent message with text', () => {
    const t = thread([
      msg('user', 'first question', 'm1'),
      msg('assistant', 'the assistant reply', 'm2'),
    ]);
    expect(threadSidebarPreview(t)).toBe('the assistant reply');
  });

  it('skips trailing empty messages and collapses whitespace', () => {
    const t = thread([
      msg('user', 'hello   there\n\nworld', 'm1'),
      msg('assistant', '   ', 'm2'),
    ]);
    expect(threadSidebarPreview(t)).toBe('hello there world');
  });

  it('truncates long previews with an ellipsis', () => {
    const long = 'x'.repeat(150);
    const preview = threadSidebarPreview(thread([msg('user', long)]));
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBe(101);
  });
});

describe('threadMatchesSearch', () => {
  const t = thread([msg('user', 'a question about zebras', 'm1')], { title: 'Animals', subtitle: 'wildlife notes' });

  it('matches an empty query', () => {
    expect(threadMatchesSearch(t, '')).toBe(true);
  });

  it('matches on the title', () => {
    expect(threadMatchesSearch(t, 'animals')).toBe(true);
  });

  it('matches on the subtitle', () => {
    expect(threadMatchesSearch(t, 'wildlife')).toBe(true);
  });

  it('matches on a message body', () => {
    expect(threadMatchesSearch(t, 'zebras')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(threadMatchesSearch(t, 'spaceship')).toBe(false);
  });
});

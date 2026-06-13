import { describe, expect, it } from 'vitest';
import { threadMatchesSearch } from '../../src/core/threadSelectors';
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

import { describe, expect, it } from 'vitest';
import type { Thread } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { RagSourceRepository } from '../../../src/services/rag/sourceRepository';
import { collectRagSources } from '../../../src/services/rag/indexer';

describe('RagSourceRepository', () => {
  it('keeps the archived-thread corpus complete without hydrating ChatStore', async () => {
    const full = Array.from({ length: 25 }, (_, index) => thread(`t${index}`, `message ${index}`));
    full[12] = { ...full[12], deletedAt: 10 };
    const current = full.map((item, index) => index < 10 ? item : { ...item, messages: [], archived: true });
    const repository = new RagSourceRepository({
      getCurrent: () => ({ threads: current, notes: [], facts: [] }),
      listArchivedThreads: async () => full.slice(10),
    });

    const snapshot = await repository.load();
    const sources = collectRagSources(snapshot);

    expect(current.filter(item => item.archived).every(item => item.messages.length === 0)).toBe(true);
    expect(sources).toHaveLength(24);
    expect(sources.some(source => source.threadId === 't24')).toBe(true);
    expect(sources.some(source => source.threadId === 't12')).toBe(false);
  });

  it('prefers a current full thread and ignores orphaned archive records', async () => {
    const current = thread('current', 'hot text');
    const repository = new RagSourceRepository({
      getCurrent: () => ({ threads: [current], notes: [], facts: [] }),
      listArchivedThreads: async () => [thread('current', 'stale text'), thread('orphan', 'orphan text')],
    });
    const sources = collectRagSources(await repository.load());
    expect(sources.map(source => source.text)).toEqual(['hot text']);
  });
});

function thread(id: string, content: string): Thread {
  return {
    id,
    title: id,
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [{ id: `m-${id}`, role: 'user', content, createdAt: 2 }],
  };
}

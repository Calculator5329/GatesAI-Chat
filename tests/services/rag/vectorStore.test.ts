import { describe, expect, it } from 'vitest';
import { RagVectorStore } from '../../../src/services/rag/vectorStore';
import { MemoryRagPersistence, vectorForText } from './helpers';

describe('RagVectorStore', () => {
  it('ranks by dot-product similarity and excludes model mismatches', async () => {
    const persistence = new MemoryRagPersistence();
    const store = new RagVectorStore(persistence);
    await store.putMany([
      {
        id: 'a',
        sourceType: 'note',
        sourceId: 'n1',
        text: 'alpha launch notes',
        vector: vectorForText('alpha'),
        updatedAt: 1,
        model: 'model-a',
      },
      {
        id: 'b',
        sourceType: 'note',
        sourceId: 'n2',
        text: 'beta launch notes',
        vector: vectorForText('beta'),
        updatedAt: 2,
        model: 'model-a',
      },
      {
        id: 'stale',
        sourceType: 'note',
        sourceId: 'n3',
        text: 'alpha stale notes',
        vector: vectorForText('alpha'),
        updatedAt: 3,
        model: 'old-model',
      },
    ]);

    const results = await store.search(vectorForText('alpha'), 'model-a', 3);

    expect(results.map(result => result.chunk.id)).toEqual(['a', 'b']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('hydrates its cache once and invalidates on writes', async () => {
    const persistence = new MemoryRagPersistence();
    const store = new RagVectorStore(persistence);
    await store.putMany([{
      id: 'a',
      sourceType: 'memory',
      sourceId: 'm1',
      text: 'alpha memory',
      vector: vectorForText('alpha'),
      updatedAt: 1,
      model: 'model-a',
    }]);
    const allSpy = viSpyAll(persistence);

    await store.search(vectorForText('alpha'), 'model-a', 1);
    await store.search(vectorForText('alpha'), 'model-a', 1);
    expect(allSpy.count).toBe(1);

    await store.putMany([{
      id: 'b',
      sourceType: 'memory',
      sourceId: 'm2',
      text: 'beta memory',
      vector: vectorForText('beta'),
      updatedAt: 2,
      model: 'model-a',
    }]);
    await store.search(vectorForText('beta'), 'model-a', 1);
    expect(allSpy.count).toBe(2);
  });
});

function viSpyAll(persistence: MemoryRagPersistence): { count: number } {
  const state = { count: 0 };
  const original = persistence.all.bind(persistence);
  persistence.all = async () => {
    state.count += 1;
    return original();
  };
  return state;
}

import { describe, expect, it } from 'vitest';
import {
  RAG_CHUNK_POLICY_VERSION,
  RAG_INDEX_SCHEMA_VERSION,
  RagVectorStore,
  type RagIndexManifest,
} from '../../../src/services/rag/vectorStore';
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

  it('activates complete generations atomically and rejects dimension drift', async () => {
    const persistence = new MemoryRagPersistence();
    const store = new RagVectorStore(persistence);
    const manifest = generation('g1', 3, 1);
    await store.replaceGeneration(manifest, [{
      id: 'g1:a', generationId: 'g1', sourceType: 'note', sourceId: 'a', text: 'alpha',
      vector: vectorForText('alpha'), updatedAt: 1, model: 'model-a',
    }]);
    expect((await store.activeManifest())?.generationId).toBe('g1');
    expect(await store.search(new Float32Array([1, 0]), 'model-a', 5)).toEqual([]);
    await expect(store.replaceGeneration(generation('bad', 2, 1), [{
      id: 'bad:a', generationId: 'bad', sourceType: 'note', sourceId: 'a', text: 'alpha',
      vector: vectorForText('alpha'), updatedAt: 1, model: 'model-a',
    }])).rejects.toThrow('dimension mismatch');
    expect((await store.activeManifest())?.generationId).toBe('g1');
  });

  it('serves legacy v1 chunks when no manifest exists', async () => {
    const persistence = new MemoryRagPersistence();
    await persistence.putMany([{
      id: 'legacy', sourceType: 'note', sourceId: 'old', text: 'alpha',
      vector: vectorForText('alpha').buffer as ArrayBuffer, updatedAt: 1, model: 'model-a',
    }]);
    const store = new RagVectorStore(persistence);
    expect((await store.search(vectorForText('alpha'), 'model-a', 1))[0]?.chunk.id).toBe('legacy');
  });
});

function generation(generationId: string, vectorDimensions: number, chunkCount: number): RagIndexManifest {
  return {
    schemaVersion: RAG_INDEX_SCHEMA_VERSION,
    generationId,
    embeddingModel: 'model-a',
    vectorDimensions,
    chunkPolicyVersion: RAG_CHUNK_POLICY_VERSION,
    startedAt: 1,
    completedAt: 2,
    sourceCount: 1,
    chunkCount,
  };
}

function viSpyAll(persistence: MemoryRagPersistence): { count: number } {
  const state = { count: 0 };
  const original = persistence.all.bind(persistence);
  persistence.all = async () => {
    state.count += 1;
    return original();
  };
  return state;
}

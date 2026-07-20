import { describe, expect, it } from 'vitest';
import { retrieveHybrid } from '../../../src/services/rag/retrieval';
import {
  RAG_CHUNK_POLICY_VERSION,
  RAG_INDEX_SCHEMA_VERSION,
  RagVectorStore,
  type RagChunk,
} from '../../../src/services/rag/vectorStore';
import { FakeEmbedder, MemoryRagPersistence, vectorForText } from './helpers';

describe('hybrid retrieval', () => {
  it('fuses lexical exact-ID and dense candidates with complete provenance', async () => {
    const store = await makeStore([
      chunk('exact', 'Ticket ORB-731 tracks resumed uploads.', 't1', 'user'),
      chunk('dense', 'alpha upload troubleshooting', 't2', 'assistant'),
    ]);
    const results = await retrieveHybrid({
      request: { query: 'ORB-731 alpha', purpose: 'explicit_recall', limit: 5 },
      model: 'model-a', embedder: new FakeEmbedder(), vectorStore: store,
    });
    expect(results[0].sourceId).toBe('exact');
    expect(results[0].lexicalRank).toBe(1);
    expect(results[0].reference).toContain('message:t1:exact');
    expect(results[0].role).toBe('user');
  });

  it('excludes the active thread and diversifies automatic context by source', async () => {
    const store = await makeStore([
      chunk('a1', 'alpha one', 'active', 'user'),
      chunk('b1', 'alpha two', 'history', 'user'),
      chunk('b2', 'alpha three', 'history', 'assistant'),
      { ...chunk('note', 'alpha four'), sourceType: 'note' },
    ]);
    const results = await retrieveHybrid({
      request: { query: 'alpha', purpose: 'automatic_context', activeThreadId: 'active', limit: 3 },
      model: 'model-a', embedder: new FakeEmbedder(), vectorStore: store,
    });
    expect(results.some(result => result.threadId === 'active')).toBe(false);
    expect(results.filter(result => result.threadId === 'history')).toHaveLength(1);
    expect(results).toHaveLength(2);
  });

  it('honors source policy and abstains on an unrelated automatic query', async () => {
    const store = await makeStore([
      { ...chunk('fact', 'beta preference'), sourceType: 'memory' },
      { ...chunk('note', 'gamma project'), sourceType: 'note' },
    ]);
    const explicit = await retrieveHybrid({
      request: { query: 'beta', purpose: 'explicit_recall', limit: 5, sourcePolicy: { sourceTypes: ['note'] } },
      model: 'model-a', embedder: new FakeEmbedder(), vectorStore: store,
    });
    expect(explicit.every(result => result.sourceType === 'note')).toBe(true);
    const none = await retrieveHybrid({
      request: { query: 'unrelated violin', purpose: 'automatic_context', limit: 5 },
      model: 'model-a', embedder: { embed: async () => [new Float32Array([-1, -1, -1])] }, vectorStore: store,
    });
    expect(none).toEqual([]);
  });
});

async function makeStore(chunks: RagChunk[]): Promise<RagVectorStore> {
  const store = new RagVectorStore(new MemoryRagPersistence());
  const generationId = 'g1';
  const withGeneration = chunks.map((item, index) => ({
    ...item,
    id: `${generationId}:${item.id}`,
    generationId,
    fingerprint: `f${index}`,
    chunkOrdinal: 0,
  }));
  await store.replaceGeneration({
    schemaVersion: RAG_INDEX_SCHEMA_VERSION,
    generationId,
    embeddingModel: 'model-a',
    vectorDimensions: 3,
    chunkPolicyVersion: RAG_CHUNK_POLICY_VERSION,
    startedAt: 1,
    completedAt: 2,
    sourceCount: chunks.length,
    chunkCount: chunks.length,
  }, withGeneration);
  return store;
}

function chunk(sourceId: string, text: string, threadId?: string, role?: 'user' | 'assistant'): RagChunk {
  return {
    id: sourceId, sourceType: 'message', sourceId, ...(threadId ? { threadId } : {}),
    ...(role ? { role } : {}), text, vector: vectorForText(text), updatedAt: 1, model: 'model-a',
  };
}

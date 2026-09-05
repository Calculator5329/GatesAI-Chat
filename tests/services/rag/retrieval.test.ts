import { describe, expect, it } from 'vitest';
import { RAG_CANDIDATE_POOL, retrieveHybrid, type RagRetrievalRequest } from '../../../src/services/rag/retrieval';
import {
  RAG_CHUNK_POLICY_VERSION,
  RAG_INDEX_SCHEMA_VERSION,
  RagVectorStore,
  type RagChunk,
} from '../../../src/services/rag/vectorStore';
import { FakeEmbedder, MemoryRagPersistence, vectorForText } from './helpers';

describe('hybrid retrieval', () => {
  it.each([
    { name: 'active thread', purpose: 'automatic_context', activeThreadId: 'excluded' },
    { name: 'excluded thread', purpose: 'automatic_context', sourcePolicy: { excludedReferences: ['thread:excluded'] } },
    { name: 'library-only automatic context', purpose: 'automatic_context', sourcePolicy: { sourceTypes: ['library'] } },
    { name: 'library-only semantic recall', purpose: 'explicit_recall', sourcePolicy: { sourceTypes: ['library'] } },
  ] satisfies Array<Omit<RagRetrievalRequest, 'query' | 'limit'> & { name: string }>)('filters $name before dense candidate truncation', async ({ name: _name, ...policy }) => {
    const eligible = {
      ...chunk('eligible', policy.purpose === 'automatic_context' ? 'alpha launch notes' : 'launch notes'),
      sourceType: 'library' as const,
      vector: new Float32Array([0.8, 0.6, 0]),
    };
    const store = await makeStore([
      ...Array.from({ length: RAG_CANDIDATE_POOL + 1 }, (_, index) => chunk(`excluded-${index}`, 'alpha', 'excluded', 'user')),
      eligible,
    ]);
    const results = await retrieveHybrid({
      request: { ...policy, query: 'alpha', limit: 5 },
      model: 'model-a', embedder: new FakeEmbedder(), vectorStore: store,
    });
    expect(results.map(result => result.sourceId)).toEqual(['eligible']);
    expect(results[0].denseRank).toBe(1);
    expect(results[0].denseScore).toBeCloseTo(0.8);
  });

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

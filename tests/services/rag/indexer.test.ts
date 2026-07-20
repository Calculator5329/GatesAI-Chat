import { describe, expect, it } from 'vitest';
import type { Thread } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { chunkText, collectRagSources, RagIndexer, type RagWatermark, type RagWatermarkStore } from '../../../src/services/rag/indexer';
import { RagVectorStore } from '../../../src/services/rag/vectorStore';
import { FakeEmbedder, MemoryRagPersistence } from './helpers';

describe('RagIndexer', () => {
  it('keeps short messages whole and splits long text on paragraph boundaries with overlap', () => {
    expect(chunkText('short message')).toEqual(['short message']);
    const long = [
      'alpha '.repeat(120),
      'beta '.repeat(120),
      'gamma '.repeat(120),
    ].join('\n\n');

    const chunks = chunkText(long);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('alpha');
    expect(chunks[1]).toContain('beta');
    expect(chunks[1].length).toBeGreaterThan(700);
  });

  it('uses watermarks so unchanged sources are skipped on rerun', async () => {
    const embedder = new FakeEmbedder();
    const persistence = new MemoryRagPersistence();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence),
      embedder,
      getSources: () => ({
        threads: [thread('t1', 'm1', 'alpha project')],
        notes: [],
        facts: ['beta preference'],
      }),
      getModel: () => 'model-a',
      getActive: () => true,
      isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });

    const first = await indexer.tick();
    const second = await indexer.tick();

    expect(first.indexed).toBe(2);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(2);
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]).toHaveLength(2);
    expect(await persistence.count()).toBe(2);
  });

  it('purges chunks for deleted threads', async () => {
    let deleted = false;
    const persistence = new MemoryRagPersistence();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence),
      embedder: new FakeEmbedder(),
      getSources: () => ({
        threads: [thread('t1', 'm1', 'alpha project', deleted ? Date.now() : undefined)],
        notes: [],
        facts: [],
      }),
      getModel: () => 'model-a',
      getActive: () => true,
      isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });

    await indexer.tick();
    expect(await persistence.count()).toBe(1);

    deleted = true;
    const result = await indexer.tick();

    expect(result.purged).toBeGreaterThan(0);
    expect(await persistence.count()).toBe(0);
  });

  it('batches one hundred sources into one indexer embedding request', async () => {
    const embedder = new FakeEmbedder();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(new MemoryRagPersistence()),
      embedder,
      getSources: () => ({
        threads: Array.from({ length: 100 }, (_, index) => thread(`t${index}`, `m${index}`, `alpha ${index}`)),
        notes: [],
        facts: [],
      }),
      getModel: () => 'model-a',
      getActive: () => true,
      isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]).toHaveLength(100);
  });

  it('preserves the active generation when a replacement embedding fails', async () => {
    const persistence = new MemoryRagPersistence();
    let content = 'alpha first';
    const embedder = new FakeEmbedder();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence),
      embedder,
      getSources: () => ({ threads: [thread('t1', 'm1', content)], notes: [], facts: [] }),
      getModel: () => 'model-a',
      getActive: () => true,
      isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    const activeId = persistence.manifest?.generationId;
    content = 'beta replacement';
    embedder.embed = async () => { throw new Error('embedding failed'); };
    await expect(indexer.tick()).rejects.toThrow('embedding failed');
    expect(persistence.manifest?.generationId).toBe(activeId);
    expect([...persistence.chunks.values()][0]?.text).toBe('alpha first');
  });

  it('uses content-derived fact identities across reorderings', () => {
    const first = collectRagSources({ threads: [], notes: [], facts: ['Alpha fact', 'Beta fact'] });
    const second = collectRagSources({ threads: [], notes: [], facts: ['Beta fact', 'Alpha fact'] });
    expect(first.map(source => source.sourceId).sort()).toEqual(second.map(source => source.sourceId).sort());
  });

  it('indexes approved library documents with visible title and path provenance', () => {
    const sources = collectRagSources({
      threads: [],
      notes: [],
      facts: [],
      library: [{
        id: 'reference',
        path: '/workspace/notes/reference.md',
        title: 'Release reference',
        kind: 'document',
        text: 'The launch owner is Rowan.',
        updatedAt: 123,
      }],
    });

    expect(sources).toEqual([expect.objectContaining({
      sourceType: 'library',
      sourceId: 'reference',
      sourceTitle: 'Release reference',
      updatedAt: 123,
    })]);
    expect(sources[0].embeddingText).toContain('/workspace/notes/reference.md');
    expect(sources[0].text).toContain('The launch owner is Rowan.');
  });
});

class MemoryWatermarks implements RagWatermarkStore {
  value: Record<string, RagWatermark> = {};
  load(): Record<string, RagWatermark> {
    return { ...this.value };
  }
  save(watermarks: Record<string, RagWatermark>): void {
    this.value = { ...watermarks };
  }
  clear(): void {
    this.value = {};
  }
}

function thread(id: string, messageId: string, content: string, deletedAt?: number): Thread {
  return {
    id,
    title: id,
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [{ id: messageId, role: 'user', content, createdAt: 10 }],
    ...(deletedAt ? { deletedAt } : {}),
  };
}

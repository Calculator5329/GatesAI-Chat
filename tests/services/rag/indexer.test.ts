import { describe, expect, it } from 'vitest';
import type { Thread } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { chunkText, RagIndexer, type RagWatermark, type RagWatermarkStore } from '../../../src/services/rag/indexer';
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
    expect(embedder.calls).toHaveLength(2);
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

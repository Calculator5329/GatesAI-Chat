import { describe, expect, it } from 'vitest';
import type { Thread } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { chunkText, collectRagSources, contentHash, RagIndexer, type RagWatermark, type RagWatermarkStore } from '../../../src/services/rag/indexer';
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

  it('skips unchanged sources on rerun', async () => {
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

  it('embeds only changed inputs across a 100-source corpus, removal and explicit rebuild', async () => {
    const embedder = new FakeEmbedder();
    let threads = Array.from({ length: 100 }, (_, i) => thread(`t${i}`, `m${i}`, `alpha ${i}`));
    const persistence = new MemoryRagPersistence();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence), embedder,
      getSources: () => ({ threads, notes: [], facts: [] }),
      getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    const initial = persistence.manifest?.generationId;
    await indexer.tick();
    expect(persistence.manifest?.generationId).toBe(initial);
    threads[0] = thread('t0', 'm0', 'beta edit');
    await indexer.tick();
    const edited = persistence.manifest?.generationId;
    threads = threads.slice(1);
    await indexer.tick();
    expect(persistence.manifest?.generationId).not.toBe(edited);
    expect(await persistence.count()).toBe(99);
    await indexer.rebuild();
    expect(embedder.calls.map(call => call.length)).toEqual([100, 1, 99]);
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

  it('reembeds both neighboring messages after an edit and both after a title change', async () => {
    const conversation = thread('t1', 'm1', 'alpha question');
    conversation.messages.push({ id: 'm2', role: 'assistant', content: 'beta answer', createdAt: 11 });
    const embedder = new FakeEmbedder();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(new MemoryRagPersistence()), embedder,
      getSources: () => ({ threads: [conversation, thread('t2', 'other', 'gamma independent')], notes: [], facts: [] }),
      getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    conversation.messages[1].content = 'replacement answer';
    await indexer.tick();
    expect(embedder.calls[1]).toHaveLength(2);
    expect(embedder.calls[1][0]).toContain('Following assistant: replacement answer');
    expect(embedder.calls[1][1]).toContain('Assistant: replacement answer');
    conversation.title = 'Renamed conversation';
    await indexer.tick();
    expect(embedder.calls[2]).toHaveLength(2);
    expect(embedder.calls[2].every(input => input.includes('Thread: Renamed conversation'))).toBe(true);
    expect(embedder.calls.map(call => call.length)).toEqual([3, 2, 2]);
  });

  it('uses exact input despite matching watermarks and timestamps, and reuses after restart', async () => {
    const watermarks = new MemoryWatermarks();
    const persistence = new MemoryRagPersistence();
    const embedder = new FakeEmbedder();
    const conversation = thread('t1', 'm1', 'alpha first');
    const deps = {
      embedder, getSources: () => ({ threads: [conversation], notes: [], facts: [] }),
      getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
      watermarkStore: watermarks,
    };
    await new RagIndexer({ ...deps, vectorStore: new RagVectorStore(persistence) }).tick();
    await new RagIndexer({ ...deps, vectorStore: new RagVectorStore(persistence) }).tick();
    expect(embedder.calls).toHaveLength(1);
    conversation.messages[0].content = 'beta changed';
    const changed = collectRagSources(deps.getSources())[0];
    watermarks.value['message:t1:m1'].hash = contentHash(changed.embeddingText!);
    await new RagIndexer({ ...deps, vectorStore: new RagVectorStore(persistence) }).tick();
    expect(embedder.calls).toHaveLength(2);
    expect([...persistence.chunks.values()][0].text).toBe('beta changed');
  });

  it('reembeds changed library context but updates metadata without an embedding call', async () => {
    const document = { id: 'doc', path: '/approved/a.md', title: 'Reference', kind: 'document' as const,
      text: 'alpha reference', updatedAt: 1 };
    const embedder = new FakeEmbedder();
    const persistence = new MemoryRagPersistence();
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence), embedder,
      getSources: () => ({ threads: [], notes: [], facts: [], library: [document] }),
      getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    document.path = '/approved/b.md';
    await indexer.tick();
    expect(embedder.calls[1][0]).toContain('Path: /approved/b.md');
    document.updatedAt = 2;
    await indexer.tick();
    expect(embedder.calls).toHaveLength(2);
    expect([...persistence.chunks.values()][0].updatedAt).toBe(2);
    document.title = 'Renamed reference';
    await indexer.tick();
    expect(embedder.calls[2][0]).toContain('Library source: Renamed reference');
  });

  it.each(['legacy', 'policy', 'model', 'dimensions', 'nonfinite'] as const)(
    'refreshes incompatible %s records instead of reusing them', async reason => {
      const persistence = new MemoryRagPersistence();
      const embedder = new FakeEmbedder();
      let model = 'model-a';
      const deps = {
        embedder, getSources: () => ({ threads: [thread('t', 'm', 'alpha')], notes: [], facts: [] }),
        getModel: () => model, getActive: () => true, isStreaming: () => false,
        watermarkStore: new MemoryWatermarks(),
      };
      await new RagIndexer({ ...deps, vectorStore: new RagVectorStore(persistence) }).tick();
      const chunk = [...persistence.chunks.values()][0];
      if (reason === 'legacy') delete chunk.embeddingInput;
      if (reason === 'policy') persistence.manifest!.chunkPolicyVersion = 1;
      if (reason === 'model') model = 'model-b';
      if (reason === 'dimensions') chunk.vector = new Float32Array([1, 0]).buffer;
      if (reason === 'nonfinite') chunk.vector = new Float32Array([NaN, 0, 0]).buffer;
      await new RagIndexer({ ...deps, vectorStore: new RagVectorStore(persistence) }).tick();
      expect(embedder.calls.map(call => call.length)).toEqual([1, 1]);
      expect(persistence.manifest?.embeddingModel).toBe(model);
    },
  );

  it('rejects same-model dimension drift even when every chunk changes; rebuild can refresh', async () => {
    const persistence = new MemoryRagPersistence();
    const embedder = new FakeEmbedder();
    const conversation = thread('t', 'm', 'alpha old');
    const indexer = new RagIndexer({
      vectorStore: new RagVectorStore(persistence), embedder,
      getSources: () => ({ threads: [conversation], notes: [], facts: [] }),
      getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
      watermarkStore: new MemoryWatermarks(),
    });
    await indexer.tick();
    const activeId = persistence.manifest?.generationId;
    conversation.messages[0].content = 'beta changed';
    embedder.embed = async () => [new Float32Array([1, 0])];
    await expect(indexer.tick()).rejects.toThrow('dimensions changed');
    expect(persistence.manifest?.generationId).toBe(activeId);
    await indexer.rebuild();
    expect(persistence.manifest?.vectorDimensions).toBe(2);
  });

  it.each(['count', 'empty', 'dimensions', 'nonfinite', 'cancel', 'persistence'] as const)(
    'retains the old generation and watermarks on %s failure', async failure => {
      const persistence = new MemoryRagPersistence();
      const watermarks = new MemoryWatermarks();
      const embedder = new FakeEmbedder();
      const conversation = thread('t1', 'm1', 'alpha old');
      const controller = new AbortController();
      const indexer = new RagIndexer({
        vectorStore: new RagVectorStore(persistence), embedder,
        getSources: () => ({ threads: [conversation, thread('t2', 'm2', 'gamma unchanged')], notes: [], facts: [] }),
        getModel: () => 'model-a', getActive: () => true, isStreaming: () => false,
        watermarkStore: watermarks,
      });
      await indexer.tick();
      const manifest = { ...persistence.manifest };
      const oldWatermarks = watermarks.load();
      const oldChunks = await persistence.all();
      conversation.messages[0].content = 'beta new';
      embedder.embed = async () => {
        if (failure === 'count') return [];
        if (failure === 'empty') return [new Float32Array()];
        if (failure === 'dimensions') return [new Float32Array([1, 0])];
        if (failure === 'nonfinite') return [new Float32Array([Infinity, 0, 0])];
        if (failure === 'cancel') controller.abort();
        return [new Float32Array([0, 1, 0])];
      };
      if (failure === 'persistence') persistence.replaceGeneration = async () => { throw new Error('storage unavailable'); };
      await expect(indexer.tick(controller.signal)).rejects.toThrow();
      expect(persistence.manifest).toEqual(manifest);
      expect(await persistence.all()).toEqual(oldChunks);
      expect(watermarks.load()).toEqual(oldWatermarks);
    },
  );

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

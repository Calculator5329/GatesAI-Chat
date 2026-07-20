import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Thread } from '../../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { LEGACY_RAG_SETTINGS_STORAGE_KEY, RAG_SETTINGS_STORAGE_KEY, RagStore } from '../../../src/services/rag/RagStore';
import { RagVectorStore } from '../../../src/services/rag/vectorStore';
import { FakeEmbedder, MemoryRagPersistence } from './helpers';
import { clearAppStorage } from '../../helpers/storage';

describe('RagStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('injects only above-threshold matches and respects the auto-inject toggle', async () => {
    const rag = makeRagStore({
      threads: [
        thread('t1', 'Alpha plan', 'alpha migration architecture'),
        thread('t2', 'Beta plan', 'beta launch notes'),
      ],
    });
    await rag.runIndexOnce();

    const block = await rag.semanticContextForUserText('alpha question');
    expect(block).toContain('Historical memory evidence');
    expect(block).toContain('Alpha plan');
    expect(block).not.toContain('Beta plan');

    rag.setAutoInject(false);
    await expect(rag.semanticContextForUserText('alpha question')).resolves.toBe('');
  });

  it('recall formats quoted snippets with source labels', async () => {
    const rag = makeRagStore({
      threads: [thread('t1', 'Alpha thread', 'alpha chat history')],
      facts: ['beta memory fact'],
    });
    await rag.runIndexOnce();

    const out = await rag.recall('beta', 2);

    expect(out).toContain('memory');
    expect(out).toContain('> beta memory fact');
  });

  it('is inactive when Ollama is offline or the embedding model is missing', () => {
    expect(makeRagStore({ online: false, tagNames: ['nomic-embed-text:latest'] }).active).toBe(false);
    expect(makeRagStore({ online: true, tagNames: ['llama3.2:latest'] }).status).toBe('model_missing');
    expect(makeRagStore({ online: true, tagNames: ['nomic-embed-text:latest'] }).active).toBe(true);
  });

  it('migrates v1 settings and applies recoverable source controls', async () => {
    localStorage.removeItem(RAG_SETTINGS_STORAGE_KEY);
    localStorage.setItem(LEGACY_RAG_SETTINGS_STORAGE_KEY, JSON.stringify({ autoInject: false, embeddingModel: 'nomic-embed-text' }));
    const rag = makeRagStore({ threads: [thread('t1', 'Alpha', 'alpha memory')] });
    expect(rag.settings).toMatchObject({
      autoInject: false,
      sourceTypes: { message: true, note: true, memory: true },
      excludedSources: [],
    });
    await rag.runIndexOnce();
    expect(await rag.recall('alpha', 2)).toContain('Alpha');
    rag.excludeSource('thread:t1');
    expect(await rag.recall('alpha', 2)).toBe('No semantic memory matches.');
    rag.includeSource('thread:t1');
    expect(await rag.recall('alpha', 2)).toContain('Alpha');
    rag.setSourceType('message', false);
    expect(await rag.recall('alpha', 2)).toBe('No semantic memory matches.');
  });

  it('provides stable fact references for source-level UI controls', () => {
    const rag = makeRagStore({});
    const first = rag.factSourceReference('  Prefers   concise Updates ');
    const second = rag.factSourceReference('prefers concise updates');

    expect(first).toBe(second);
    expect(first).toMatch(/^memory:memory-/);
    expect(rag.isSourceExcluded(first)).toBe(false);
    rag.excludeSource(first);
    expect(rag.isSourceExcluded(first)).toBe(true);
  });
});

function makeRagStore(options: {
  threads?: Thread[];
  facts?: string[];
  online?: boolean;
  tagNames?: string[];
}): RagStore {
  return new RagStore({
    getSources: () => ({
      threads: options.threads ?? [],
      notes: [],
      facts: options.facts ?? [],
    }),
    getOllamaOnline: () => options.online ?? true,
    getOllamaTagNames: () => options.tagNames ?? ['nomic-embed-text:latest'],
    getOllamaBaseUrl: () => 'http://ollama.test',
    isStreaming: () => false,
    embedder: new FakeEmbedder(),
    vectorStore: new RagVectorStore(new MemoryRagPersistence()),
  });
}

function thread(id: string, title: string, content: string): Thread {
  return {
    id,
    title,
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [{ id: `${id}-m1`, role: 'user', content, createdAt: 10 }],
  };
}

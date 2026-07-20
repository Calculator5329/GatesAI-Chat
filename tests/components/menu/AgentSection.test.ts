import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSection } from '../../../src/components/menu/sections/Agent';
import { StoreProvider } from '../../../src/stores/context';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { RagStore } from '../../../src/services/rag/RagStore';
import { RagVectorStore } from '../../../src/services/rag/vectorStore';
import { FakeEmbedder, MemoryRagPersistence } from '../../services/rag/helpers';
import { clearAppStorage } from '../../helpers/storage';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let rag: RagStore | null = null;

beforeEach(() => clearAppStorage());
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  rag?.dispose();
  rag = null;
  vi.unstubAllEnvs();
  clearAppStorage();
});

function renderAgent(webLite = false) {
  if (webLite) vi.stubEnv('VITE_GATESAI_WEB', '1');
  const profile = new UserProfileStore();
  profile.addFact('Prefers concise updates');
  rag = new RagStore({
    getSources: () => ({ threads: [], notes: [], facts: profile.facts, library: [] }),
    getOllamaOnline: () => true,
    getOllamaTagNames: () => ['nomic-embed-text:latest'],
    getOllamaBaseUrl: () => 'http://ollama.test',
    isStreaming: () => false,
    embedder: new FakeEmbedder(),
    vectorStore: new RagVectorStore(new MemoryRagPersistence()),
  });
  runInAction(() => {
    rag!.servingCompleteGeneration = true;
    rag!.indexedChunkCount = 12;
    rag!.activeGenerationAt = Date.now();
  });
  const store = {
    profile,
    rag,
    chat: {
      threads: [{ id: 'thread-1', title: 'Launch notes', updatedAt: Date.now(), deletedAt: undefined }],
    },
    notes: {
      sortedByRecency: [{ id: 'note-1', title: 'Storage design', body: 'Local details', createdAt: 1, updatedAt: Date.now() }],
    },
    ollama: {
      pulls: new Map(),
      isPulling: () => false,
      startPull: vi.fn(async () => true),
      cancelPull: vi.fn(),
    },
    bridge: { isOnline: true },
    library: {
      sources: [],
      activeSources: [],
      readyCount: 0,
      refreshing: false,
      lastError: null,
      pickAndAdd: vi.fn(async () => true),
      refreshAll: vi.fn(async () => undefined),
      setEnabled: vi.fn(),
    },
  } as unknown as RootStore;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(StoreProvider, { store, children: createElement(AgentSection) })));
  return { host, store };
}

describe('Agent semantic-memory management', () => {
  it('renders Option 2 terse source rows and persists source controls', () => {
    const rendered = renderAgent();
    expect(rendered.host.textContent).toContain('Saved facts · 1');
    expect(rendered.host.textContent).toContain('Semantic recall');
    expect(rendered.host.textContent).toContain('Ready');
    expect(rendered.host.textContent).toContain('12 chunks');
    expect(rendered.host.textContent).toContain('Conversations');
    expect(rendered.host.textContent).toContain('Notes');

    const switches = Array.from(rendered.host.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    expect(switches).toHaveLength(5);
    act(() => switches[1].click());
    expect(rag!.settings.sourceTypes.message).toBe(false);

    const conversations = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent?.includes('Conversations'))!;
    act(() => (conversations as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain('Launch notes');
    const exclude = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent === 'Exclude')!;
    act(() => (exclude as HTMLButtonElement).click());
    expect(rag!.settings.excludedSources).toContain('thread:thread-1');
    expect(rendered.host.textContent).toContain('Include');
  });

  it('keeps Web Lite honest and hides unusable Ollama controls', () => {
    const rendered = renderAgent(true);
    expect(rendered.host.textContent).toContain('Local documents and databases are available in the desktop app');
    expect(rendered.host.textContent).toContain('needs the desktop app and a local Ollama embedding model');
    expect(rendered.host.textContent).not.toContain('Try recall');
    expect(rendered.host.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { makeAutoObservable } from 'mobx';
import { StoreProvider } from '../../../src/stores/context';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { OpenRouterStore } from '../../../src/stores/OpenRouterStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UiStore } from '../../../src/stores/UiStore';
import { ImageGenStore } from '../../../src/stores/ImageGenStore';
import { GatesMenu } from '../../../src/components/menu/GatesMenu';
import type { RootStore } from '../../../src/stores/RootStore';
import type { MenuSectionKey } from '../../../src/core/types';
import { setThreadArchiveStoreForTests } from '../../../src/services/persistence';
import type { ThreadArchiveStore } from '../../../src/services/persistence/idb';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockRouterStore {
  private _section: MenuSectionKey = 'settings';

  constructor() { makeAutoObservable(this); }

  get menuSection(): MenuSectionKey { return this._section; }

  goMenu(section: MenuSectionKey): void { this._section = section; }
}

function buildStore(section: MenuSectionKey = 'settings'): { store: RootStore; router: MockRouterStore } {
  const router = new MockRouterStore();
  router.goMenu(section);
  const profile = new UserProfileStore();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const openrouter = new OpenRouterStore(registry);
  const ui = new UiStore();
  const imageGen = new ImageGenStore();
  const chat = {
    threads: [],
    visibleThreads: [],
    clearAllThreads: () => {},
    clearThreadMemory: () => {},
    createThread: () => 'thread-1',
  };
  const store = {
    router,
    profile,
    providers,
    registry,
    openrouter,
    ui,
    imageGen,
    openrouterCompatibility: {
      running: false,
      progress: '',
      completed: 0,
      total: 0,
      lastRun: null,
      lastError: null,
      logLines: [],
      openRouterReady: false,
      workspaceReady: false,
      curatedCount: 0,
      sampleCount: 0,
      allCount: 0,
      start: async () => {},
      cancel: () => {},
    },
    search: {
      braveReady: false,
      braveApiKey: '',
      setBraveKey: () => {},
      clearBraveKey: () => {},
    },
    chat,
    notes: { notes: [], clear: () => {} },
    imageJobs: { history: [], clearHistory: () => {} },
    ollama: { config: { apiKey: '' }, count: 0, setKey: () => {}, clearCatalog: () => {} },
    localRuntime: {
      runtimes: {
        ollama: { status: 'stopped', installPath: '', managed: true, baseUrl: 'http://127.0.0.1:11434', logs: [] },
        comfyui: { status: 'stopped', installPath: '', managed: true, baseUrl: 'http://127.0.0.1:8188', logs: [] },
      },
      resetConfig: () => {},
    },
    bridge: { isOnline: false, client: { request: async () => ({}) } },
    offlineLibrary: {
      enabled: false,
      available: true,
      phase: 'disabled',
      statusLabel: 'Disabled',
      declaredPermissions: [],
      error: null,
      setEnabled: async () => {},
      refresh: async () => {},
    },
    skills: { skills: [], count: 0, loading: false, refresh: async () => {} },
  } as unknown as RootStore;
  builtStores.push(store);
  return { store, router };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const builtStores: RootStore[] = [];

function renderMenu(store: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, { store, children: createElement(GatesMenu) }));
  });
  return host;
}

function findTab(container: HTMLDivElement, label: string): HTMLElement | null {
  const tabStrip = container.querySelector('.gates-menu__tabs') ?? container;
  const all = Array.from(tabStrip.querySelectorAll<HTMLElement>('button, [role="button"]'));
  return all.find(el => el.textContent?.includes(label)) ?? null;
}

async function flushLazySections(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function preloadApiSection(): Promise<void> {
  await act(async () => {
    await import('../../../src/components/menu/sections/api/ApiSection');
  });
}

async function preloadUsageSection(): Promise<void> {
  await act(async () => {
    await import('../../../src/components/menu/sections/Usage');
  });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  while (builtStores.length > 0) builtStores.pop()?.ui.dispose();
  setThreadArchiveStoreForTests(undefined);
});

describe('GatesMenu tab strip', () => {
  it('renders the trimmed top-level menu tabs', async () => {
    const { store, router } = buildStore('settings');
    const rendered = renderMenu(store);
    await flushLazySections();

    for (const label of ['Agent', 'Models', 'Local', 'Workspace', 'Gallery', 'Settings', 'Usage']) {
      const tab = findTab(rendered, label);
      expect(tab?.hasAttribute('disabled')).toBe(false);
      expect(tab?.style.cursor).toBe('pointer');
    }

    act(() => findTab(rendered, 'Models')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(router.menuSection).toBe('models');
  });

  it('removes retired and renamed top-level tabs', async () => {
    const { store } = buildStore('settings');
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(findTab(rendered, 'Profile')).toBeNull();
    expect(findTab(rendered, 'API')).toBeNull();
  });

  it('renders the real Usage section from message usage', async () => {
    await preloadUsageSection();
    const archiveStore: ThreadArchiveStore = {
      getThread: async () => null,
      usage: async () => ({ entries: 500, bytes: 2048, truncated: true }),
      putThread: async () => undefined,
      deleteThread: async () => undefined,
    };
    setThreadArchiveStoreForTests(archiveStore);
    const { store } = buildStore('usage');
    (store.chat as unknown as { threads: unknown[] }).threads = [{
      id: 't1',
      title: 'Usage thread',
      subtitle: '',
      pinned: false,
      modelId: 'or-gemini-3-flash',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{
        id: 'a1',
        role: 'assistant',
        content: 'done',
        createdAt: Date.now(),
        model: 'or-gemini-3-flash',
        usage: [{
          providerId: 'openrouter',
          modelId: 'google/gemini-3-flash',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costUsd: 0.0042,
          costSource: 'provider',
        }],
      }],
    }];
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Usage');
    expect(rendered.textContent).toContain('$0.0042');
    expect(rendered.textContent).toContain('Gemini 3 Flash');
    expect(rendered.textContent).toContain('Local storage');
    expect(rendered.textContent).toContain('App data');
    expect(rendered.textContent).toContain('Thread archive');
    expect(rendered.textContent).toContain('at least 2.0 KB · 500+ archived threads');
    expect(rendered.textContent).toContain('does not delete or compact data');
  });

  it('renders local-led Usage with local cost rows', async () => {
    await preloadUsageSection();
    const { store } = buildStore('usage');
    (store.chat as unknown as { threads: unknown[] }).threads = [{
      id: 't-local',
      title: 'Local usage thread',
      subtitle: '',
      pinned: false,
      modelId: 'ollama-qwen2.5:7b',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{
        id: 'a-local',
        role: 'assistant',
        content: 'done',
        createdAt: Date.now(),
        model: 'ollama-qwen2.5:7b',
        usage: [{
          providerId: 'ollama',
          modelId: 'qwen2.5:7b',
          promptTokens: 90,
          completionTokens: 30,
          totalTokens: 120,
          costUsd: 0,
          costSource: 'local',
        }],
      }],
    }];
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Cloud $0.00 - Local 120 tokens (free)');
    expect(rendered.textContent).toContain('Requests');
    expect(rendered.textContent).toContain('local');
    expect(rendered.textContent).not.toContain('$0.00local');
    expect(rendered.textContent).toContain('Unavailable');
  });

  it('does not render the retired Appearance tab', async () => {
    const { store } = buildStore('settings');
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(findTab(rendered, 'Appearance')).toBeNull();
  });

  it('renders only the OpenRouter model access surface', async () => {
    await preloadApiSection();
    const { store } = buildStore('models');
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Models');
    expect(rendered.textContent).toContain('Cloud model access');
    expect(rendered.textContent).toContain('OpenRouter');
    expect(rendered.textContent).toContain('Local models');
    expect(rendered.textContent).toContain('Ollama not running');
    expect(rendered.textContent).not.toContain('Routing');
    expect(rendered.textContent).not.toContain('Coming soon');
    expect(rendered.textContent).not.toContain('Anthropic');
    expect(rendered.textContent).not.toContain('OpenAI');
  });

  it('renders the Models menu local row as online and links to Local', async () => {
    await preloadApiSection();
    const { store, router } = buildStore('models');
    (store.localRuntime as unknown as { runtimes: { ollama: { status: string } } }).runtimes.ollama.status = 'online';
    (store.ollama as unknown as { count: number }).count = 2;
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Ollama online - 2 models');
    const button = Array.from(rendered.querySelectorAll('button'))
      .find(item => item.textContent === 'Open Local') as HTMLButtonElement | undefined;
    act(() => button?.click());

    expect(router.menuSection).toBe('local');
  });
});

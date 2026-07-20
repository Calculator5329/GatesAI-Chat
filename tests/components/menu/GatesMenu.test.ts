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
    chat,
    notes: { notes: [], clear: () => {} },
    imageJobs: { history: [], clearHistory: () => {} },
    ollama: { config: { apiKey: '' }, count: 0, fetching: false, lastError: null, setKey: () => {}, clearCatalog: () => {}, refresh: async () => {} },
    localRuntime: {
      runtimes: {
        ollama: { status: 'stopped', installPath: '', managed: true, baseUrl: 'http://127.0.0.1:11434', logs: [] },
        comfyui: { status: 'stopped', installPath: '', managed: true, baseUrl: 'http://127.0.0.1:8188', logs: [] },
      },
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      setBaseUrl: () => {},
      resetConfig: () => {},
    },
    bridge: { isOnline: false, client: { request: async () => ({}) } },
    search: { braveReady: false, braveApiKey: '', setBraveKey: () => {}, clearBraveKey: () => {} },
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

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  while (builtStores.length > 0) builtStores.pop()?.ui.dispose();
});

describe('GatesMenu tab strip', () => {
  it('renders the trimmed top-level menu tabs', async () => {
    const { store, router } = buildStore('settings');
    const rendered = renderMenu(store);
    await flushLazySections();

    for (const label of ['Settings', 'Models', 'Agent']) {
      const tab = findTab(rendered, label);
      expect(tab?.hasAttribute('disabled')).toBe(false);
      expect(tab?.style.cursor).toBe('pointer');
    }

    act(() => findTab(rendered, 'Models')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(router.menuSection).toBe('models');
  });

  it('removes retired top-level tabs', async () => {
    const { store } = buildStore('settings');
    const rendered = renderMenu(store);
    await flushLazySections();

    for (const label of ['Profile', 'API', 'Appearance', 'Usage', 'Local', 'Workspace', 'Gallery']) {
      expect(findTab(rendered, label)).toBeNull();
    }
  });

  it('renders model and Brave Search setup under Models', async () => {
    await preloadApiSection();
    const { store } = buildStore('models');
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Models');
    expect(rendered.textContent).toContain('OpenRouter');
    expect(rendered.textContent).toContain('Local models');
    expect(rendered.textContent).toContain('Ollama not running');
    expect(rendered.textContent).toContain('Web search');
    expect(rendered.textContent).toContain('Brave grounding');
    expect(rendered.textContent).not.toContain('Compatibility test suite');
    expect(rendered.textContent).not.toContain('Coming soon');
    expect(rendered.textContent).not.toContain('Anthropic');
  });

  it('shows the local catalog as online with a model count', async () => {
    await preloadApiSection();
    const { store } = buildStore('models');
    (store.localRuntime as unknown as { runtimes: { ollama: { status: string } } }).runtimes.ollama.status = 'online';
    (store.ollama as unknown as { count: number }).count = 2;
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Ollama online · 2 models');
    const refresh = Array.from(rendered.querySelectorAll('button'))
      .find(item => item.textContent === 'Refresh models');
    expect(refresh).toBeDefined();
  });
});

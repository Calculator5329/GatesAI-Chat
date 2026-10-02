import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    ollama: {
      config: { apiKey: '' as string | undefined },
      count: 0,
      online: false,
      fetching: false,
      lastError: undefined,
      pulls: new Map(),
      activePullModel: null,
      isPulling: () => false,
      hasModelTag: () => false,
      startPull: async () => true,
      cancelPull: () => {},
      setKey: () => {},
      clearCatalog: () => {},
      refresh: async () => {},
    },
    localRuntime: {
      runtimes: {
        ollama: { status: 'offline', checking: false, baseUrl: 'http://127.0.0.1:11434', lastError: 'Nothing is answering at http://127.0.0.1:11434.' },
        comfyui: { status: 'offline', checking: false, baseUrl: 'http://127.0.0.1:8188', lastError: 'Nothing is answering at http://127.0.0.1:8188.' },
      },
      comfyDiscovery: null,
      preferLocalModels: true,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      setBaseUrl: () => {},
      setPreferLocalModels: () => {},
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

function cleanupRendered(): void {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

afterEach(() => {
  cleanupRendered();
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
    expect(rendered.textContent).toContain('Local');
    expect(rendered.textContent).toContain('Nothing is answering at http://127.0.0.1:11434.');
    expect(rendered.querySelector('[data-testid="settings.local-card.install-ollama"]')).not.toBeNull();
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
    Object.assign(store.ollama, { online: true, count: 2 });
    const rendered = renderMenu(store);
    await flushLazySections();

    expect(rendered.textContent).toContain('Ollama · 2 chat models');
    expect(rendered.textContent).not.toContain('Install Ollama');
    const check = Array.from(rendered.querySelectorAll('button'))
      .find(item => item.textContent === 'Check now');
    expect(check).toBeDefined();
  });

  it('asks for a server key only when Ollama is on another machine', async () => {
    await preloadApiSection();
    const local = buildStore('models').store;
    const onThisComputer = renderMenu(local);
    await flushLazySections();
    expect(onThisComputer.querySelector('[data-testid="settings.secret-key.input-ollama"]')).toBeNull();
    cleanupRendered();

    const remote = buildStore('models').store;
    Object.assign(remote.localRuntime, { ollamaBaseUrl: 'http://192.168.1.20:11434' });
    const onServer = renderMenu(remote);
    await flushLazySections();
    expect(onServer.querySelector('[data-testid="settings.secret-key.input-ollama"]')).not.toBeNull();
    expect(onServer.textContent).toContain('OLLAMA_HOST=0.0.0.0:11434');
  });

  it('toggles local-first new chats from the Local card', async () => {
    await preloadApiSection();
    const { store } = buildStore('models');
    const setPreferLocalModels = vi.fn();
    Object.assign(store.localRuntime, { setPreferLocalModels });
    const rendered = renderMenu(store);
    await flushLazySections();

    const toggle = rendered.querySelector<HTMLButtonElement>('[data-testid="settings.local-card.prefer-local"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    act(() => { toggle?.click(); });
    expect(setPreferLocalModels).toHaveBeenCalledWith(false);
  });
});

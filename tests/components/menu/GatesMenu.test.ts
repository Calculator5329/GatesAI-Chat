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
    localRuntime: { resetConfig: () => {} },
    bridge: { isOnline: false, client: { request: async () => ({}) } },
  } as unknown as RootStore;
  return { store, router };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

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

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('GatesMenu tab strip', () => {
  it('renders the trimmed top-level menu tabs', () => {
    const { store, router } = buildStore('settings');
    const rendered = renderMenu(store);

    for (const label of ['Agent', 'Models', 'Local', 'Workspace', 'Gallery', 'Settings']) {
      const tab = findTab(rendered, label);
      expect(tab?.hasAttribute('disabled')).toBe(false);
      expect(tab?.style.cursor).toBe('pointer');
    }

    act(() => findTab(rendered, 'Models')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(router.menuSection).toBe('models');
  });

  it('removes retired and renamed top-level tabs', () => {
    const { store } = buildStore('settings');
    const rendered = renderMenu(store);

    expect(findTab(rendered, 'Profile')).toBeNull();
    expect(findTab(rendered, 'Usage')).toBeNull();
    expect(findTab(rendered, 'API')).toBeNull();
  });

  it('does not render the retired Appearance tab', () => {
    const { store } = buildStore('settings');
    const rendered = renderMenu(store);

    expect(findTab(rendered, 'Appearance')).toBeNull();
  });

  it('renders only the OpenRouter model access surface', () => {
    const { store } = buildStore('models');
    const rendered = renderMenu(store);

    expect(rendered.textContent).toContain('Models');
    expect(rendered.textContent).toContain('OpenRouter');
    expect(rendered.textContent).not.toContain('Routing');
    expect(rendered.textContent).not.toContain('Coming soon');
    expect(rendered.textContent).not.toContain('Anthropic');
    expect(rendered.textContent).not.toContain('OpenAI');
  });
});

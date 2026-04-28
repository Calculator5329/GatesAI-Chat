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
import { GatesMenu } from '../../../src/components/menu/GatesMenu';
import type { RootStore } from '../../../src/stores/RootStore';
import type { MenuSectionKey } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockRouterStore {
  private _section: MenuSectionKey = 'appearance';

  constructor() { makeAutoObservable(this); }

  get menuSection(): MenuSectionKey { return this._section; }

  goMenu(section: MenuSectionKey): void { this._section = section; }
}

function buildStore(section: MenuSectionKey = 'appearance'): { store: RootStore; router: MockRouterStore } {
  const router = new MockRouterStore();
  router.goMenu(section);
  const profile = new UserProfileStore();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const openrouter = new OpenRouterStore(registry);
  const ui = new UiStore();
  const store = { router, profile, providers, registry, openrouter, ui } as unknown as RootStore;
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
  const all = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'));
  return all.find(el => el.textContent?.includes(label)) ?? null;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('GatesMenu tab strip', () => {
  it('renders unsupported menu tabs as disabled and non-clickable', () => {
    const { store, router } = buildStore('appearance');
    const rendered = renderMenu(store);

    const usageTab = findTab(rendered, 'Usage');
    expect(usageTab?.getAttribute('aria-disabled')).toBe('true');
    expect(usageTab?.style.cursor).toBe('default');

    act(() => usageTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(router.menuSection).toBe('appearance');
  });

  it('shows a visual coming-soon treatment for unsupported tabs', () => {
    const { store } = buildStore('appearance');
    const rendered = renderMenu(store);

    const profileTab = findTab(rendered, 'Profile');
    expect(profileTab?.textContent).toContain('Coming soon');
    expect(profileTab?.style.opacity).toBe('0.5');
  });

  it('renders placeholder controls with a disabled row style', () => {
    const { store } = buildStore('api');
    const rendered = renderMenu(store);

    expect(rendered.textContent).toContain('Routing');
    expect(rendered.textContent).toContain('Coming soon');
    const disabledSelect = rendered.querySelector('select:disabled') as HTMLSelectElement | null;
    expect(disabledSelect).not.toBeNull();
  });
});

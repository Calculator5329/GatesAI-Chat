import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { GatesMenu } from '../../../src/components/menu/GatesMenu';
import { MENU_SECTIONS } from '../../../src/components/menu/menuSectionMeta';
import { RootStore } from '../../../src/stores/RootStore';
import type { GatesRuntimeMode } from '../../../src/core/runtime';
import type { MenuSectionKey } from '../../../src/core/types';
import { clearAppStorage } from '../../helpers/storage';

const runtime = vi.hoisted(() => ({ mode: 'desktop' as GatesRuntimeMode }));

vi.mock('../../../src/core/runtime', () => ({
  hasDesktopRuntime: () => runtime.mode === 'desktop',
  isHeadless: () => runtime.mode === 'headless',
  isTauri: () => runtime.mode === 'desktop',
  isWebLite: () => runtime.mode === 'web-lite',
  runtimeMode: () => runtime.mode,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SURFACES: ReadonlyArray<{
  key: MenuSectionKey;
  marker: string;
}> = [
  { key: 'settings', marker: 'Danger zone' },
  { key: 'models', marker: 'Local models' },
  { key: 'agent', marker: 'Instructions' },
];

let reactRoot: Root | null = null;
let host: HTMLDivElement | null = null;
let store: RootStore | null = null;

function renderMenu(nextStore: RootStore): HTMLDivElement {
  store = nextStore;
  host = document.createElement('div');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  act(() => {
    reactRoot!.render(createElement(StoreProvider, {
      store: nextStore,
      children: createElement(GatesMenu),
    }));
  });
  return host;
}

async function selectSurface(key: MenuSectionKey): Promise<void> {
  await act(async () => {
    switch (key) {
      case 'settings': await import('../../../src/components/menu/sections/Settings'); break;
      case 'agent': await import('../../../src/components/menu/sections/Agent'); break;
      case 'models': await import('../../../src/components/menu/sections/api/ApiSection'); break;
      default: {
        const exhausted: never = key;
        throw new Error(`unknown section ${String(exhausted)}`);
      }
    }
    store!.router.goMenu(key);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function buildStore(mode: Exclude<GatesRuntimeMode, 'headless'>): RootStore {
  const nextStore = new RootStore({ runtime: mode });

  // The walkthrough renders the desktop capability branches, but its purpose
  // is component composition rather than exercising Tauri commands. Keep
  // mount-time probes deterministic and prove that the surfaces can render
  // around stable unavailable snapshots.
  vi.spyOn(nextStore.localRuntime, 'refreshAll').mockImplementation(() => undefined);
  return nextStore;
}

afterEach(() => {
  if (reactRoot) act(() => reactRoot?.unmount());
  reactRoot = null;
  host?.remove();
  host = null;
  store?.dispose();
  store = null;
  runtime.mode = 'desktop';
  window.location.hash = '';
  clearAppStorage();
});

describe('settings surface walkthrough', () => {
  it.each(['desktop', 'web-lite'] as const)('renders and routes every menu section in %s mode', async mode => {
    runtime.mode = mode;
    window.location.hash = '';
    clearAppStorage();
    const rendered = renderMenu(buildStore(mode));

    expect(MENU_SECTIONS.map(section => section.key)).toEqual(SURFACES.map(surface => surface.key));

    for (const surface of SURFACES) {
      await selectSurface(surface.key);

      const activeTab = rendered.querySelector<HTMLButtonElement>(`.gates-menu__tab[data-active="true"]`);
      expect(activeTab?.textContent?.trim()).toBe(MENU_SECTIONS.find(section => section.key === surface.key)?.label);
      expect(store!.router.menuSection).toBe(surface.key);
      expect(window.location.hash).toBe(`#/menu/${surface.key}`);
      expect(rendered.textContent).toContain(surface.marker);
    }
  });

  it('keeps desktop-only controls out of Web Lite', async () => {
    runtime.mode = 'web-lite';
    const rendered = renderMenu(buildStore('web-lite'));

    await selectSurface('settings');
    expect(rendered.querySelector('.settings-desktop')).toBeNull();
    expect(rendered.textContent).toContain('Danger zone');
  });

  it('renders desktop settings without Web Lite copy', async () => {
    runtime.mode = 'desktop';
    const rendered = renderMenu(buildStore('desktop'));

    await selectSurface('settings');
    expect(rendered.querySelector('.settings-desktop')).not.toBeNull();
    expect(rendered.querySelector('.settings-browser-data')).toBeNull();
  });
});

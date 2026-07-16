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

vi.mock('../../../src/services/sourceWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/services/sourceWorkspace')>();
  return {
    ...actual,
    getSourceWorkspaceStatus: vi.fn(async () => ({
      available: false,
      prepared: false,
      stale: false,
      workspaceRoot: '',
      sourceRoot: '',
    })),
  };
});

vi.mock('../../../src/services/sourceBuild', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/services/sourceBuild')>();
  return {
    ...actual,
    getSourceBuildStatus: vi.fn(async () => ({ status: 'idle', steps: [], logs: [] })),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SURFACES: ReadonlyArray<{
  key: MenuSectionKey;
  marker: string;
}> = [
  { key: 'settings', marker: 'Settings' },
  { key: 'usage', marker: 'LLM usage - cloud spend and local tokens' },
  { key: 'agent', marker: 'Instructions' },
  { key: 'models', marker: 'Cloud model access' },
  { key: 'local', marker: 'Custom endpoint (OpenAI-compatible)' },
  { key: 'workspace', marker: 'Workspace root' },
  { key: 'gallery', marker: 'Gallery' },
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
      case 'usage': await import('../../../src/components/menu/sections/Usage'); break;
      case 'agent': await import('../../../src/components/menu/sections/Agent'); break;
      case 'models': await import('../../../src/components/menu/sections/api/ApiSection'); break;
      case 'local': await import('../../../src/components/menu/sections/Local'); break;
      case 'workspace': await import('../../../src/components/menu/sections/Workspace'); break;
      case 'gallery': await import('../../../src/components/menu/sections/Gallery'); break;
    }
    store!.router.goMenu(key);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim() === text);
  expect(button, `button named ${text}`).toBeDefined();
  return button!;
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
      if (surface.key === 'workspace' && mode === 'web-lite') {
        expect(rendered.textContent).toContain('Desktop-only workspace capabilities');
      } else {
        expect(rendered.textContent).toContain(surface.marker);
      }
    }

    await selectSurface('settings');
    const settingsPage = rendered.querySelector('.settings-page')!;
    act(() => buttonWithText(settingsPage, 'Manage key').click());
    expect(store!.router.menuSection).toBe('models');

    await selectSurface('settings');
    act(() => buttonWithText(rendered.querySelector('.settings-page')!, 'Models').click());
    expect(store!.router.menuSection).toBe('models');

    await selectSurface('settings');
    act(() => buttonWithText(rendered.querySelector('.settings-page')!, 'Local').click());
    expect(store!.router.menuSection).toBe('local');

    await selectSurface('models');
    act(() => buttonWithText(rendered.querySelector('.gates-menu__body')!, 'Open Local').click());
    expect(store!.router.menuSection).toBe('local');
  });

  it('keeps desktop-only controls out of Web Lite and renders explicit fallback states', async () => {
    runtime.mode = 'web-lite';
    const rendered = renderMenu(buildStore('web-lite'));

    await selectSurface('settings');
    expect(rendered.querySelector('.settings-desktop')).toBeNull();
    expect(rendered.textContent).toContain('Your data is saved in this browser');
    expect(rendered.textContent).toContain('Available only in the GatesAI desktop app');

    await selectSurface('agent');
    expect(rendered.textContent).not.toContain('Workspace skills');

    await selectSurface('local');
    expect(rendered.querySelector('[role="note"]')?.textContent).toContain('managed runtime controls are desktop-only');
    expect(rendered.textContent).not.toContain('RuntimesAuto-detect');

    await selectSurface('workspace');
    expect(rendered.querySelector('[role="note"]')?.textContent).toContain("local /workspace bridge isn't available");

    await selectSurface('gallery');
    expect(rendered.querySelector('[role="note"]')?.textContent).toContain('artifact gallery are desktop-only');
  });

  it('renders desktop settings and managed-runtime controls without Web Lite copy', async () => {
    runtime.mode = 'desktop';
    const rendered = renderMenu(buildStore('desktop'));

    await selectSurface('settings');
    expect(rendered.querySelector('.settings-desktop')).not.toBeNull();
    expect(rendered.querySelector('.settings-browser-data')).toBeNull();

    await selectSurface('local');
    expect(rendered.textContent).toContain('Runtimes');
    expect(rendered.textContent).toContain('Auto-detect');
    expect(rendered.querySelector('[role="note"]')).toBeNull();

    await selectSurface('workspace');
    expect(rendered.textContent).toContain('Source workspace');
    expect(rendered.querySelector('[role="note"]')).toBeNull();
  });
});

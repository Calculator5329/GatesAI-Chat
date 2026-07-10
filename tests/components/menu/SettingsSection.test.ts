import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { makeAutoObservable } from 'mobx';
import { StoreProvider } from '../../../src/stores/context';
import { SettingsSection } from '../../../src/components/menu/sections/Settings';
import { UiStore } from '../../../src/stores/UiStore';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockRouter {
  constructor() { makeAutoObservable(this); }
  goMenu(): void {}
}

function buildStore(): RootStore {
  const ui = new UiStore();
  const store = {
    ui,
    router: new MockRouter(),
    chat: {
      visibleThreads: [],
      threads: [],
      clearAllThreads: () => {},
      clearThreadMemory: () => {},
    },
    profile: {
      facts: [],
      defaultSystemPrompt: '',
      clearFacts: () => {},
      setDefaultSystemPrompt: () => {},
    },
    notes: { notes: [], clear: () => {} },
    imageJobs: { history: [], clearHistory: () => {} },
    providers: { getConfig: () => ({ apiKey: '' }), remove: () => {} },
    ollama: { config: { apiKey: '' }, count: 0, setKey: () => {}, clearCatalog: () => {} },
    openrouter: { count: 0, clearCache: () => {} },
    imageGen: { reset: () => {} },
    localRuntime: { resetConfig: () => {} },
    bridge: { isOnline: false, resetWorkspaceDirectory: async () => {} },
    replaceImportConfirmation: 'REPLACE',
    downloadDataExport: () => {},
    importDataFromJson: () => ({ merged: true }),
    formatDataImportResult: () => 'Imported.',
  } as unknown as RootStore;
  builtStores.push(store);
  return store;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const builtStores: RootStore[] = [];

function renderSettings(store: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, { store, children: createElement(SettingsSection) }));
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  while (builtStores.length > 0) builtStores.pop()?.ui.dispose();
});

describe('SettingsSection desktop ambient controls', () => {
  it('renders global summon and close-to-tray controls', () => {
    const store = buildStore();
    const rendered = renderSettings(store);

    expect(rendered.textContent).toContain('Global summon');
    expect(rendered.textContent).toContain('Summon shortcut');
    expect(rendered.textContent).toContain('Close button hides to tray');
    expect(rendered.textContent).toContain('Automatic thread titles');
    expect((rendered.querySelector('input[aria-label="Global summon shortcut"]') as HTMLInputElement).value)
      .toBe('Ctrl+Shift+Space');
  });

  it('surfaces shortcut unavailable state', () => {
    const store = buildStore();
    store.ui.setGlobalShortcutStatus('shortcut unavailable - in use by another app');
    const rendered = renderSettings(store);

    expect(rendered.textContent).toContain('Shortcut unavailable - in use by another app.');
  });

  it('updates settings through the toggles', () => {
    const store = buildStore();
    const rendered = renderSettings(store);
    const switches = Array.from(rendered.querySelectorAll<HTMLButtonElement>('[role="switch"]'));

    act(() => switches[0]?.click());
    act(() => switches[1]?.click());
    act(() => switches[2]?.click());

    expect(store.ui.autoNamingEnabled).toBe(false);
    expect(store.ui.globalSummonEnabled).toBe(false);
    expect(store.ui.closeButtonHidesToTray).toBe(true);
  });
});

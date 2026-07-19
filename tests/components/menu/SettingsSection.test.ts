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
      activeThread: null,
      visibleThreads: [],
      threads: [],
      clearAllThreads: () => {},
    },
    profile: {
      facts: [],
      defaultSystemPrompt: '',
      clearFacts: () => {},
      setDefaultSystemPrompt: () => {},
    },
    providers: { getConfig: () => ({ apiKey: '' }), remove: () => {} },
    ollama: { config: { apiKey: '' }, setKey: () => {} },
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
  it('renders theme, conversation, and desktop controls', () => {
    const store = buildStore();
    const rendered = renderSettings(store);

    expect(rendered.textContent).toContain('Color mode');
    expect(rendered.textContent).toContain('Automatic thread titles');
    expect(rendered.textContent).toContain('Global summon');
    expect(rendered.textContent).toContain('Summon shortcut');
    expect(rendered.textContent).toContain('Close button hides to tray');
    expect((rendered.querySelector('input[aria-label="Global summon shortcut"]') as HTMLInputElement).value)
      .toBe('Ctrl+Shift+Space');
  });

  it('keeps the page down to core blocks only', () => {
    const store = buildStore();
    const rendered = renderSettings(store);

    expect(rendered.querySelector('.settings-theme')).not.toBeNull();
    expect(rendered.querySelector('.settings-export-import')).not.toBeNull();
    expect(rendered.querySelector('.settings-danger-zone')).not.toBeNull();
    // Retired blocks from the 7-tab menu must not come back silently.
    expect(rendered.textContent).not.toContain('Offline Library addon');
    expect(rendered.textContent).not.toContain('OpenRouter API key');
    expect(rendered.textContent).not.toContain('Super+G');
  });

  it('limits the danger zone to threads, memories, and provider keys', () => {
    const store = buildStore();
    const rendered = renderSettings(store);
    const zone = rendered.querySelector('.settings-danger-zone')!;

    expect(zone.textContent).toContain('Delete all threads');
    expect(zone.textContent).toContain('Delete memories');
    expect(zone.textContent).toContain('Remove provider keys');
    expect(zone.textContent).not.toContain('workspace');
    expect(zone.textContent).not.toContain('image');
    const deleteButtons = Array.from(zone.querySelectorAll('button')).filter(b => b.textContent === 'Delete...');
    expect(deleteButtons.length).toBe(3);
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

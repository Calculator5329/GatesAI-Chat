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
      clearThreadMemory: () => {},
      setThreadModel: () => {},
    },
    registry: { all: [] },
    dock: { openPanel: () => {} },
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
    offlineLibrary: {
      enabled: false,
      available: true,
      phase: 'disabled',
      statusLabel: 'Disabled',
      declaredPermissions: [],
      error: null,
      detailsError: null,
      sources: null,
      knowledgeShortcutAvailable: true,
      knowledgeShortcutError: null,
      profileOptions: [],
      profileOverrideId: null,
      profileOverride: null,
      profileForTask: () => null,
      setProfileOverride: () => {},
      setEnabled: () => Promise.resolve(),
      refresh: () => Promise.resolve(),
    },
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
    expect(rendered.textContent).toContain('Offline Library addon');
    expect(rendered.textContent).toContain('No cloud fallback');
    expect(rendered.textContent).toContain('Super+G');
    expect(rendered.textContent).toContain('never falls back to a cloud model');
    expect((rendered.querySelector('input[aria-label="Global summon shortcut"]') as HTMLInputElement).value)
      .toBe('Ctrl+Shift+Space');
  });

  it('leads with local/appearance settings before the cloud credential card', () => {
    const store = buildStore();
    const rendered = renderSettings(store);

    const theme = rendered.querySelector('.settings-theme');
    const apiKeyCard = rendered.querySelector('.settings-apikey-card');
    expect(theme).not.toBeNull();
    expect(apiKeyCard).not.toBeNull();
    expect(apiKeyCard!.textContent).toContain('OpenRouter API key');

    // Theme (appearance) must appear before the OpenRouter API-key card in the document.
    const relation = theme!.compareDocumentPosition(apiKeyCard!);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('shows evidence-backed local routing and accepts an explicit override', () => {
    const store = buildStore();
    const quality = {
      id: 'library-quality', label: 'Offline documents — quality', task_kind: 'knowledge_document', model: 'phi4',
      retrieval: { strategy: 'hybrid-native', mode: 'hybrid', include_kiwix: true },
      evidence: { trials: 84, average_score: 86.39, score_confidence_95: { low: 83.52, high: 89.27 }, source_hit_rate: 1, expected_term_recall: 0.9762, citation_validity_rate: 0.4881, average_retrieval_latency_ms: 699.25, average_generation_latency_ms: 5390.18, error_count: 0 },
      limitations: ['Highest observed document score, but slower than balanced.'],
    };
    const schema = { ...quality, id: 'public-schema-accurate', label: 'Public schema — accurate', task_kind: 'public_database_schema', model: 'qwen2.5-coder:14b', evidence: { ...quality.evidence, trials: 6, average_score: 94 } };
    let override: string | null = null;
    let modelId: string | null = null;
    let dockKind: string | null = null;
    Object.assign(store.offlineLibrary, {
      enabled: true, phase: 'healthy', statusLabel: 'Connected', profileOptions: [schema, quality],
      profileForTask: (task: string) => task === 'public_database_schema' ? schema : quality,
      setProfileOverride: (id: string | null) => { override = id; },
    });
    Object.assign(store.registry, {
      all: [
        { id: 'ollama-phi4', providerId: 'ollama', providerModelId: 'phi4' },
        { id: 'ollama-qwen2.5-coder:14b', providerId: 'ollama', providerModelId: 'qwen2.5-coder:14b' },
      ],
    });
    Object.assign(store.chat, {
      activeThread: { id: 'thread-1', modelId: 'ollama-other' },
      setThreadModel: (_threadId: string, nextModelId: string) => { modelId = nextModelId; },
    });
    Object.assign(store.dock, { openPanel: (kind: string) => { dockKind = kind; } });
    const rendered = renderSettings(store);

    expect(rendered.textContent).toContain('Task-aware recommendations');
    expect(rendered.textContent).toContain('qwen2.5-coder:14b');
    expect(rendered.textContent).toContain('phi4');
    expect(rendered.textContent).toContain('95% CI');
    const select = rendered.querySelector<HTMLSelectElement>('[aria-label="Offline Library routing profile"]');
    act(() => {
      if (select) {
        select.value = 'library-quality';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(override).toBe('library-quality');
    const useButtons = Array.from(rendered.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent === 'Use for this chat');
    act(() => useButtons[0]?.click());
    expect(override).toBe('public-schema-accurate');
    expect(modelId).toBe('ollama-qwen2.5-coder:14b');
    const explorer = Array.from(rendered.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Open in right dock');
    act(() => explorer?.click());
    expect(dockKind).toBe('offline-library');
  });
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { OfflineLibraryKnowledgeArena } from '../../../src/core/offlineLibrary';
import { OfflineLibraryPanel } from '../../../src/components/dock/OfflineLibraryPanel';
import { StoreProvider } from '../../../src/stores/context';
import type { RootStore } from '../../../src/stores/RootStore';
import arenaFixture from '../../fixtures/offline-library/v1.3/knowledge-arena.json';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

function renderPanel(offlineLibrary: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const store = { offlineLibrary } as unknown as RootStore;
  act(() => root?.render(createElement(StoreProvider, {
    store,
    children: createElement(OfflineLibraryPanel, { params: {} }),
  })));
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('OfflineLibraryPanel', () => {
  it('renders publication-safe benchmark metrics and trust labeling', () => {
    const arena = arenaFixture as OfflineLibraryKnowledgeArena;
    const rendered = renderPanel({
      enabled: true,
      phase: 'healthy',
      statusLabel: 'Connected',
      knowledgeArena: arena,
      sources: { sources: [{ name: 'public-docs' }] },
      detailsError: null,
    });

    expect(rendered.textContent).toContain('Sanitized repeated benchmark fixture');
    expect(rendered.textContent).toContain('local-model-a');
    expect(rendered.textContent).toContain('hybrid-native');
    expect(rendered.textContent).toContain('95% CI 75.0–85.0');
    expect(rendered.textContent).toContain('URI-grounding proxies');
    expect(rendered.textContent).toContain('No raw answers');
  });

  it('filters model × setup cells without changing aggregate evidence', () => {
    const base = arenaFixture as OfflineLibraryKnowledgeArena;
    const first = base.cells?.[0];
    const arena: OfflineLibraryKnowledgeArena = {
      ...base,
      cells: first ? [first, { ...first, model: 'local-model-b', averageScore: 70 }] : [],
    };
    const rendered = renderPanel({
      enabled: true,
      phase: 'healthy',
      statusLabel: 'Connected',
      knowledgeArena: arena,
      sources: { sources: [] },
      detailsError: null,
    });
    const modelSelect = rendered.querySelectorAll('select')[0] as HTMLSelectElement;
    act(() => {
      modelSelect.value = 'local-model-b';
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const cells = rendered.querySelector('.offline-library-panel__cells');
    expect(cells?.textContent).toContain('local-model-b');
    expect(cells?.textContent).not.toContain('local-model-a');
  });

  it('degrades clearly when the addon is disabled', () => {
    const rendered = renderPanel({ enabled: false, phase: 'disabled', statusLabel: 'Disabled' });
    expect(rendered.textContent).toContain('Enable Offline Library in Settings');
  });
});

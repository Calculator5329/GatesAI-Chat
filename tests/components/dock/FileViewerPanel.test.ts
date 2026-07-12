// FileViewerPanel content-type dispatch with a mocked bridge facade:
// markdown → markdown renderer, JSON → per-key <details>, HTML → sandboxed
// iframe (same policy constant as HtmlArtifactPreview), text → <pre>,
// and read failures render in-panel.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { UiStore } from '../../../src/stores/UiStore';
import { FileViewerPanel } from '../../../src/components/dock/FileViewerPanel';
import { __htmlArtifactPreviewTestApi } from '../../../src/components/editorial/HtmlArtifactPreview';
import type { RootStore } from '../../../src/stores/RootStore';
import type { BridgeStore } from '../../../src/stores/BridgeStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ui: UiStore | null = null;

type ReadResult = { ok: true; content: string; mime: string } | { ok: false; reason: string };

function mockBridge(result: ReadResult): BridgeStore {
  return {
    isOnline: true,
    readWorkspaceTextFile: async (_path: string) => result,
  } as unknown as BridgeStore;
}

async function renderPanel(path: string, result: ReadResult): Promise<HTMLDivElement> {
  ui = new UiStore();
  const store = { bridge: mockBridge(result), ui } as unknown as RootStore;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(StoreProvider, {
        store,
        children: createElement(FileViewerPanel, { params: { path } }),
      }),
    );
  });
  // Let the async read settle and re-render.
  await act(async () => {});
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  ui?.dispose();
  ui = null;
  localStorage.removeItem('gatesai.uiprefs.v1');
});

describe('FileViewerPanel content-type dispatch', () => {
  it('renders markdown through the markdown renderer', async () => {
    const rendered = await renderPanel('/workspace/notes/plan.md', {
      ok: true,
      content: '# Plan Heading\n\nSome body text.',
      mime: 'text/markdown',
    });
    const container = rendered.querySelector('[data-testid="dock-file-viewer-markdown"]');
    expect(container).not.toBeNull();
    expect(container?.querySelector('h1')?.textContent).toBe('Plan Heading');
    expect(container?.textContent).toContain('Some body text.');
  });

  it('renders a JSON object as one <details> per top-level key', async () => {
    const rendered = await renderPanel('/workspace/data/config.json', {
      ok: true,
      content: JSON.stringify({ alpha: { a: 1 }, beta: [1, 2] }),
      mime: 'application/json',
    });
    const container = rendered.querySelector('[data-testid="dock-file-viewer-json"]');
    expect(container).not.toBeNull();
    const summaries = [...(container?.querySelectorAll('summary') ?? [])].map(el => el.textContent);
    expect(summaries).toEqual(['alpha', 'beta']);
  });

  it('falls back to raw text for invalid JSON', async () => {
    const rendered = await renderPanel('/workspace/data/broken.json', {
      ok: true,
      content: '{oops',
      mime: 'application/json',
    });
    const container = rendered.querySelector('[data-testid="dock-file-viewer-json"]');
    expect(container?.querySelector('details')).toBeNull();
    expect(container?.querySelector('pre')?.textContent).toBe('{oops');
  });

  it('renders HTML in the shared sandboxed iframe', async () => {
    const rendered = await renderPanel('/workspace/artifacts/page.html', {
      ok: true,
      content: '<html><body>hi</body></html>',
      mime: 'text/html',
    });
    const iframe = rendered.querySelector('[data-testid="dock-file-viewer-html"] iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe(__htmlArtifactPreviewTestApi.sandbox);
  });

  it('renders anything else as plain preformatted text', async () => {
    const rendered = await renderPanel('/workspace/logs/run.txt', {
      ok: true,
      content: 'line one\nline two',
      mime: 'text/plain',
    });
    const pre = rendered.querySelector('[data-testid="dock-file-viewer-text"] pre');
    expect(pre?.textContent).toBe('line one\nline two');
  });

  it('renders read failures in-panel', async () => {
    const rendered = await renderPanel('/workspace/missing.md', {
      ok: false,
      reason: 'not found: /workspace/missing.md',
    });
    const notice = rendered.querySelector('[data-testid="dock-file-viewer-notice"]');
    expect(notice?.textContent).toContain('not found: /workspace/missing.md');
  });
});

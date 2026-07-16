import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { HtmlArtifactPreview, __htmlArtifactPreviewTestApi } from '../../../src/components/editorial/HtmlArtifactPreview';
import {
  __artifactPreviewTestApi,
  loadHtmlArtifactPreview,
  peekHtmlArtifactPreview,
  type ArtifactPreviewBridge,
} from '../../../src/services/bridge/artifactPreview';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HTML_PATH = '/workspace/artifacts/reports/demo.html';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderPreview(bridge: unknown): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: { bridge } as unknown as RootStore,
        children: createElement(HtmlArtifactPreview, { path: HTML_PATH, label: 'Demo' }),
      }),
    );
  });
  return host;
}

function htmlFromPreviewFrame(frame: HTMLIFrameElement | null | undefined): string {
  const src = frame?.getAttribute('src') ?? '';
  if (!src.startsWith('data:text/html')) return frame?.getAttribute('srcdoc') ?? '';
  const encoded = src.split(',', 2)[1] ?? '';
  return decodeURIComponent(encoded);
}

function onlineBridge(overrides: {
  stat?: Record<string, unknown>;
  read?: Record<string, unknown>;
  files?: Record<string, string>;
  reject?: boolean;
} = {}) {
  const request = vi.fn(async (op: string, data?: unknown) => {
    if (overrides.reject) throw new Error('boom');
    const path = (data as { path?: string } | undefined)?.path ?? HTML_PATH;
    if (op === 'fs.stat') {
      return {
        path,
        kind: 'file',
        size: 64,
        mtime: 1,
        ...overrides.stat,
      };
    }
    if (op === 'fs.read') {
      const isImage = /\.(png|svg)$/i.test(path);
      return {
        path,
        content: overrides.files?.[path] ?? '<!doctype html><button id="x">Hi</button>',
        encoding: isImage ? 'base64' : 'utf8',
        size: 64,
        mime: path.endsWith('.png') ? 'image/png' : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html',
        ...(path === HTML_PATH ? overrides.read : {}),
      };
    }
    throw new Error(`unexpected op ${op}`);
  });
  return withPreviewFacade({
    isOnline: true,
    client: { request },
    openWorkspacePath: vi.fn(async () => true),
  });
}

/** Mirrors the thin BridgeStore facade methods the component calls. */
function withPreviewFacade<T extends object>(bridge: T): T & {
  peekHtmlArtifactPreview: typeof peekHtmlArtifactPreview;
  loadHtmlArtifactPreview: (path: string) => ReturnType<typeof loadHtmlArtifactPreview>;
} {
  return {
    ...bridge,
    peekHtmlArtifactPreview,
    loadHtmlArtifactPreview(path: string) {
      return loadHtmlArtifactPreview(this as unknown as ArtifactPreviewBridge, path);
    },
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.querySelectorAll('.html-artifact-fullscreen').forEach(node => node.remove());
  __artifactPreviewTestApi.reset();
  vi.restoreAllMocks();
});

describe('HtmlArtifactPreview', () => {
  it('applies the preview CSP without modifying downloaded artifact content', () => {
    const source = '<html><body>portable</body></html>';
    const preview = __htmlArtifactPreviewTestApi.createPreviewDocumentUrl(source).url;
    const download = __htmlArtifactPreviewTestApi.createDownloadDocumentUrl(source).url;

    expect(decodeURIComponent(preview.split(',', 2)[1] ?? '')).toContain('Content-Security-Policy');
    expect(decodeURIComponent(download.split(',', 2)[1] ?? '')).toBe(source);
  });

  it('reads HTML through fs.stat and fs.read, then renders a sandboxed document preview', async () => {
    const bridge = onlineBridge();
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(bridge.client.request).toHaveBeenNthCalledWith(1, 'fs.stat', { path: HTML_PATH });
    expect(bridge.client.request).toHaveBeenNthCalledWith(2, 'fs.read', { path: HTML_PATH, encoding: 'utf8' });
    const iframe = rendered.querySelector('iframe');
    expect(htmlFromPreviewFrame(iframe)).toContain('<button id="x">Hi</button>');
    expect(iframe?.getAttribute('srcdoc')).toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^(data:text\/html|blob:)/);
    expect(iframe?.getAttribute('sandbox')).toBe(__htmlArtifactPreviewTestApi.sandbox);
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('inlines workspace-relative CSS and JS assets for document previews', async () => {
    const bridge = onlineBridge({
      files: {
        [HTML_PATH]: '<!doctype html><html><head><link rel="stylesheet" href="./demo.css"><script src="demo.js" defer></script></head><body><h1>Hi</h1><img src="chart.png"></body></html>',
        '/workspace/artifacts/reports/demo.css': 'body { background: rgb(1, 2, 3); }',
        '/workspace/artifacts/reports/demo.js': 'window.demoReady = true;',
        '/workspace/artifacts/reports/chart.png': 'abc123',
      },
    });
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });

    const previewHtml = htmlFromPreviewFrame(rendered.querySelector('iframe'));
    expect(previewHtml).toContain('<style>body { background: rgb(1, 2, 3); }</style>');
    expect(previewHtml).toContain('<script defer="">window.demoReady = true;</script>');
    expect(previewHtml).toContain('src="data:image/png;base64,abc123"');
    expect(previewHtml).not.toContain('href="./demo.css"');
    expect(previewHtml).not.toContain('src="demo.js"');
  });

  it('refreshes a cached preview when the workspace file changes', async () => {
    __artifactPreviewTestApi.set(HTML_PATH, {
      html: '<!doctype html><html><body><h1>Old plain preview</h1></body></html>',
      size: 64,
      mtime: 1,
    });
    const bridge = onlineBridge({
      stat: { size: 64, mtime: 2 },
      files: {
        [HTML_PATH]: '<!doctype html><html><head><style>body { background: #000; color: #0ff; }</style></head><body><h1>Neon Invaders</h1></body></html>',
      },
    });
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });

    const previewHtml = htmlFromPreviewFrame(rendered.querySelector('iframe'));
    expect(previewHtml).toContain('Neon Invaders');
    expect(previewHtml).toContain('background: #000');
    expect(previewHtml).not.toContain('Old plain preview');
    expect(bridge.client.request).toHaveBeenCalledWith('fs.stat', { path: HTML_PATH });
    expect(bridge.client.request).toHaveBeenCalledWith('fs.read', { path: HTML_PATH, encoding: 'utf8' });
  });

  it('keeps inline styles and inlines parent-directory SVG assets', async () => {
    const htmlPath = '/workspace/artifacts/reports/portfolio_dashboard/index.html';
    const bridge = onlineBridge({
      files: {
        [htmlPath]: '<!doctype html><html><head><style>body { background: #0f0f1a; color: white; }</style></head><body><img src="../../images/local/dashboard_hero.svg"><h1>Project Portfolio</h1></body></html>',
        '/workspace/artifacts/images/local/dashboard_hero.svg': 'PHN2Zz48L3N2Zz4=',
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        createElement(StoreProvider, {
          store: { bridge } as unknown as RootStore,
          children: createElement(HtmlArtifactPreview, { path: htmlPath, label: 'Portfolio' }),
        }),
      );
    });

    await act(async () => {
      await flushMicrotasks();
    });

    const previewHtml = htmlFromPreviewFrame(host.querySelector('iframe'));
    expect(previewHtml).toContain('<style>body { background: #0f0f1a; color: white; }</style>');
    expect(previewHtml).toContain('src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="');
    expect(previewHtml).toContain('<h1>Project Portfolio</h1>');
  });

  it('shows a fallback when the bridge is offline', async () => {
    const rendered = renderPreview(withPreviewFacade({
      isOnline: false,
      client: { request: vi.fn() },
      openWorkspacePath: vi.fn(async () => true),
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(rendered.textContent).toContain('Bridge offline');
    expect(rendered.querySelector('iframe')).toBeNull();
  });

  it('shows a fallback for HTML files over 2 MB', async () => {
    const bridge = onlineBridge({ stat: { size: 2 * 1024 * 1024 + 1 } });
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(rendered.textContent).toContain('over 2 MB');
    expect(bridge.client.request).toHaveBeenCalledTimes(1);
  });

  it('opens fullscreen on preview click and closes on Escape', async () => {
    const bridge = onlineBridge();
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      (rendered.querySelector('.html-artifact-preview') as HTMLElement).click();
    });

    expect(htmlFromPreviewFrame(document.querySelector('.html-artifact-fullscreen iframe'))).toContain('Hi');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('.html-artifact-fullscreen')).toBeNull();
  });

  it('opens the artifact in the OS from the action button', async () => {
    const bridge = onlineBridge();
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });
    const open = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Open in OS') as HTMLButtonElement;

    await act(async () => {
      open.click();
    });

    expect(bridge.openWorkspacePath).toHaveBeenCalledWith(HTML_PATH);
  });

  it('toggles a loaded workspace artifact between preview and source', async () => {
    const rendered = renderPreview(onlineBridge());
    await act(async () => { await flushMicrotasks(); });
    const source = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Source') as HTMLButtonElement;

    act(() => source.click());
    expect(rendered.querySelector('iframe')).toBeNull();
    expect(rendered.querySelector('.html-artifact-preview__source')?.textContent).toContain('<button id="x">Hi</button>');

    const preview = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Preview') as HTMLButtonElement;
    act(() => preview.click());
    expect(rendered.querySelector('iframe')).not.toBeNull();
  });
});

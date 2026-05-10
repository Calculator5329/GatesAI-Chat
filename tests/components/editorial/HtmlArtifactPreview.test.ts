import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { HtmlArtifactPreview, __htmlArtifactPreviewTestApi } from '../../../src/components/editorial/HtmlArtifactPreview';
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
      return {
        path,
        content: overrides.files?.[path] ?? '<!doctype html><button id="x">Hi</button>',
        encoding: path.endsWith('.png') ? 'base64' : 'utf8',
        size: 64,
        mime: path.endsWith('.png') ? 'image/png' : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html',
        ...(path === HTML_PATH ? overrides.read : {}),
      };
    }
    throw new Error(`unexpected op ${op}`);
  });
  return {
    isOnline: true,
    client: { request },
    openWorkspacePath: vi.fn(async () => true),
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.querySelectorAll('.html-artifact-fullscreen').forEach(node => node.remove());
  __htmlArtifactPreviewTestApi.reset();
  vi.restoreAllMocks();
});

describe('HtmlArtifactPreview', () => {
  it('reads HTML through fs.stat and fs.read, then renders sandboxed srcDoc', async () => {
    const bridge = onlineBridge();
    const rendered = renderPreview(bridge);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(bridge.client.request).toHaveBeenNthCalledWith(1, 'fs.stat', { path: HTML_PATH });
    expect(bridge.client.request).toHaveBeenNthCalledWith(2, 'fs.read', { path: HTML_PATH, encoding: 'utf8' });
    const iframe = rendered.querySelector('iframe');
    expect(iframe?.getAttribute('srcdoc')).toContain('<button id="x">Hi</button>');
    expect(iframe?.getAttribute('sandbox')).toBe(__htmlArtifactPreviewTestApi.sandbox);
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('inlines workspace-relative CSS and JS assets for srcDoc previews', async () => {
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

    const srcdoc = rendered.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<style>body { background: rgb(1, 2, 3); }</style>');
    expect(srcdoc).toContain('<script defer="">window.demoReady = true;</script>');
    expect(srcdoc).toContain('src="data:image/png;base64,abc123"');
    expect(srcdoc).not.toContain('href="./demo.css"');
    expect(srcdoc).not.toContain('src="demo.js"');
  });

  it('shows a fallback when the bridge is offline', async () => {
    const rendered = renderPreview({
      isOnline: false,
      client: { request: vi.fn() },
      openWorkspacePath: vi.fn(async () => true),
    });

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

    expect(document.querySelector('.html-artifact-fullscreen iframe')?.getAttribute('srcdoc')).toContain('Hi');

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
});

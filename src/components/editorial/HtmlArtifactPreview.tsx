// Renders the editorial chat HtmlArtifactPreview surface and its local interaction state.
// Called by EditorialChat, EditorialMessage, or the sidebar shell; depends on RootStore hooks, core message types, and UI primitives.
// Invariant: persisted chat state stays in stores while components derive view state from props/hooks.
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FsReadResp, FsStatResp } from '../../core/workspace';
import { isWorkspacePath } from '../../core/workspacePaths';
import { useBridgeStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';

const HTML_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
const HTML_CACHE_LIMIT = 12;
const HTML_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';

type HtmlLoadState =
  | { status: 'loading' }
  | { status: 'ready'; html: string; size: number }
  | { status: 'error'; reason: string };

type PreviewDocumentUrl = { url: string; revoke?: () => void };

const htmlCache = new Map<string, { html: string; size: number }>();
const inflightLoads = new Map<string, Promise<HtmlLoadState>>();

function cacheGet(path: string): { html: string; size: number } | undefined {
  const value = htmlCache.get(path);
  if (!value) return undefined;
  htmlCache.delete(path);
  htmlCache.set(path, value);
  return value;
}

function cacheSet(path: string, value: { html: string; size: number }): void {
  if (htmlCache.has(path)) htmlCache.delete(path);
  htmlCache.set(path, value);
  while (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest === undefined) break;
    htmlCache.delete(oldest);
  }
}

export function isHtmlWorkspacePath(path: string): boolean {
  const clean = path.trim().split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  return isWorkspacePath(path) && (clean.endsWith('.html') || clean.endsWith('.htm'));
}

export function HtmlArtifactPreview({ path, label }: { path: string; label?: string }) {
  const bridge = useBridgeStore();
  const [state, setState] = useState<HtmlLoadState>(() => {
    const cached = cacheGet(path);
    return cached ? { status: 'ready', ...cached } : { status: 'loading' };
  });
  const [fullscreen, setFullscreen] = useState(false);
  const name = fileNameFromPath(path);
  const readyHtml = state.status === 'ready' ? state.html : null;
  const previewDocument = useMemo(
    () => readyHtml ? createPreviewDocumentUrl(readyHtml) : null,
    [readyHtml],
  );

  useEffect(() => () => previewDocument?.revoke?.(), [previewDocument]);

  useEffect(() => {
    const cached = cacheGet(path);
    let cancelled = false;
    const load = cached
      ? Promise.resolve<HtmlLoadState>({ status: 'ready', ...cached })
      : loadHtmlArtifact(bridge, path);
    void load.then(next => {
      if (!cancelled) setState(next);
    });
    return () => { cancelled = true; };
  }, [bridge, path]);

  function openOs(event: MouseEvent): void {
    event.stopPropagation();
    void bridge.openWorkspacePath(path);
  }

  return (
    <>
      <span
        className="html-artifact-preview"
        role="button"
        tabIndex={0}
        title={`Preview ${path}`}
        onClick={() => { if (state.status === 'ready') setFullscreen(true); }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && state.status === 'ready') {
            event.preventDefault();
            setFullscreen(true);
          }
        }}
      >
        <span className="html-artifact-preview__bar">
          <span className="html-artifact-preview__meta">
            <span className="html-artifact-preview__eyebrow">HTML artifact</span>
            <span className="html-artifact-preview__name">{label || name}</span>
            <code className="html-artifact-preview__path">{path}</code>
          </span>
          <button type="button" className="html-artifact-preview__open" onClick={openOs}>
            Open in OS
          </button>
        </span>
        <span className="html-artifact-preview__frame">
          {state.status === 'ready' ? (
            <iframe
              title={`Preview of ${name}`}
              src={previewDocument?.url}
              sandbox={HTML_SANDBOX}
              loading="lazy"
            />
          ) : (
            <span className="html-artifact-preview__fallback">
              {state.status === 'loading' ? 'Loading preview...' : state.reason}
            </span>
          )}
        </span>
      </span>
      {fullscreen && state.status === 'ready' && createPortal(
        <HtmlArtifactFullscreen
          path={path}
          name={name}
          html={state.html}
          onClose={() => setFullscreen(false)}
          onOpenOs={() => { void bridge.openWorkspacePath(path); }}
        />,
        document.body,
      )}
    </>
  );
}

function HtmlArtifactFullscreen({
  path,
  name,
  html,
  onClose,
  onOpenOs,
}: {
  path: string;
  name: string;
  html: string;
  onClose: () => void;
  onOpenOs: () => void;
}) {
  const previewDocument = useMemo(() => createPreviewDocumentUrl(html), [html]);

  useEffect(() => () => previewDocument.revoke?.(), [previewDocument]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="html-artifact-fullscreen" role="dialog" aria-modal="true" aria-label={`HTML artifact ${name}`}>
      <div className="html-artifact-fullscreen__bar">
        <div className="html-artifact-fullscreen__meta">
          <span>{name}</span>
          <code>{path}</code>
        </div>
        <div className="html-artifact-fullscreen__actions">
          <button type="button" onClick={onOpenOs}>Open in OS</button>
          <button type="button" aria-label="Close HTML preview" onClick={onClose}>Close</button>
        </div>
      </div>
      <iframe
        title={`Fullscreen preview of ${name}`}
        src={previewDocument.url}
        sandbox={HTML_SANDBOX}
      />
    </div>
  );
}

function createPreviewDocumentUrl(html: string): PreviewDocumentUrl {
  if (
    typeof Blob !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function'
  ) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  return { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` };
}

async function loadHtmlArtifact(bridge: BridgeStore, path: string): Promise<HtmlLoadState> {
  const cached = cacheGet(path);
  if (cached) return { status: 'ready', ...cached };
  const inflight = inflightLoads.get(path);
  if (inflight) return inflight;
  const promise = loadHtmlArtifactUncached(bridge, path).finally(() => {
    inflightLoads.delete(path);
  });
  inflightLoads.set(path, promise);
  return promise;
}

async function loadHtmlArtifactUncached(bridge: BridgeStore, path: string): Promise<HtmlLoadState> {
  if (!isHtmlWorkspacePath(path)) return { status: 'error', reason: 'Not an HTML artifact.' };
  if (!bridge.isOnline) return { status: 'error', reason: 'Bridge offline. Open in OS when the workspace reconnects.' };
  try {
    const stat = await bridge.client.request<FsStatResp>('fs.stat', { path });
    if (stat.kind !== 'file') return { status: 'error', reason: 'HTML preview is only available for files.' };
    if (stat.size > HTML_ARTIFACT_MAX_BYTES) return { status: 'error', reason: 'Preview skipped: HTML file is over 2 MB.' };
    const read = await bridge.client.request<FsReadResp>('fs.read', { path, encoding: 'utf8' });
    if (read.encoding !== 'utf8') return { status: 'error', reason: 'Preview unavailable: file is not UTF-8 text.' };
    const html = await prepareHtmlForPreview(bridge, path, read.content);
    const value = { html, size: read.size };
    cacheSet(path, value);
    return { status: 'ready', ...value };
  } catch {
    return { status: 'error', reason: 'Preview unavailable. Open in OS to view this artifact.' };
  }
}

async function prepareHtmlForPreview(bridge: BridgeStore, path: string, html: string): Promise<string> {
  if (typeof DOMParser === 'undefined') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  ensureDocumentScaffold(doc);
  await inlineStylesheets(bridge, path, doc);
  await inlineScripts(bridge, path, doc);
  await inlineMediaAssets(bridge, path, doc);
  const doctype = /^\s*<!doctype/i.test(html) ? '<!doctype html>\n' : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}

function ensureDocumentScaffold(doc: Document): void {
  if (!doc.head) {
    const head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.body ?? null);
  }
  if (!doc.querySelector('meta[name="viewport"]')) {
    const viewport = doc.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    viewport.setAttribute('content', 'width=device-width, initial-scale=1');
    doc.head.prepend(viewport);
  }
}

async function inlineStylesheets(bridge: BridgeStore, htmlPath: string, doc: Document): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'));
  await Promise.all(links.map(async link => {
    const assetPath = resolveWorkspaceAssetPath(htmlPath, link.getAttribute('href') ?? '');
    if (!assetPath) return;
    try {
      const read = await bridge.client.request<FsReadResp>('fs.read', { path: assetPath, encoding: 'utf8' });
      if (read.encoding !== 'utf8') return;
      const style = doc.createElement('style');
      style.textContent = read.content;
      link.replaceWith(style);
    } catch {
      // Keep the original link. The OS/browser path may still render it.
    }
  }));
}

async function inlineMediaAssets(bridge: BridgeStore, htmlPath: string, doc: Document): Promise<void> {
  const nodes = Array.from(doc.querySelectorAll<HTMLImageElement | HTMLSourceElement>('img[src], source[src]'));
  await Promise.all(nodes.map(async node => {
    const assetPath = resolveWorkspaceAssetPath(htmlPath, node.getAttribute('src') ?? '');
    if (!assetPath) return;
    try {
      const read = await bridge.client.request<FsReadResp>('fs.read', { path: assetPath, encoding: 'base64' });
      if (read.encoding !== 'base64') return;
      node.setAttribute('src', `data:${mimeForWorkspaceAsset(assetPath, read.mime)};base64,${read.content}`);
    } catch {
      // Keep the original src if the bridge cannot read it.
    }
  }));
}

async function inlineScripts(bridge: BridgeStore, htmlPath: string, doc: Document): Promise<void> {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]'));
  for (const script of scripts) {
    const assetPath = resolveWorkspaceAssetPath(htmlPath, script.getAttribute('src') ?? '');
    if (!assetPath) continue;
    try {
      const read = await bridge.client.request<FsReadResp>('fs.read', { path: assetPath, encoding: 'utf8' });
      if (read.encoding !== 'utf8') continue;
      const inline = doc.createElement('script');
      for (const attr of Array.from(script.attributes)) {
        if (attr.name !== 'src') inline.setAttribute(attr.name, attr.value);
      }
      inline.textContent = read.content;
      script.replaceWith(inline);
    } catch {
      // Keep the original script if the bridge cannot read it.
    }
  }
}

function resolveWorkspaceAssetPath(htmlPath: string, rawRef: string): string | null {
  const ref = rawRef.trim();
  if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return null;
  const cleanRef = ref.split(/[?#]/, 1)[0] ?? ref;
  if (!cleanRef) return null;
  if (cleanRef.startsWith('/workspace/')) return cleanRef;
  if (cleanRef.startsWith('/')) return null;
  const dir = htmlPath.split(/[?#]/, 1)[0]?.split('/').slice(0, -1).join('/') || '/workspace';
  const parts = `${dir}/${cleanRef}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  const resolved = `/${out.join('/')}`;
  return resolved.startsWith('/workspace/') ? resolved : null;
}

function mimeForWorkspaceAsset(path: string, mime?: string): string {
  const clean = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? path.toLowerCase();
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.avif')) return 'image/avif';
  if (mime && mime !== 'application/octet-stream') return mime;
  return mime || 'application/octet-stream';
}

function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  return clean.split('/').filter(Boolean).pop() || 'artifact.html';
}

export const __htmlArtifactPreviewTestApi = {
  reset: () => {
    htmlCache.clear();
    inflightLoads.clear();
  },
  set: (path: string, value: { html: string; size: number }) => cacheSet(path, value),
  has: (path: string) => htmlCache.has(path),
  size: () => htmlCache.size,
  limit: HTML_CACHE_LIMIT,
  sandbox: HTML_SANDBOX,
  createPreviewDocumentUrl,
  resolveWorkspaceAssetPath,
  mimeForWorkspaceAsset,
};

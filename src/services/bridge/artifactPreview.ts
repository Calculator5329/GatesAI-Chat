// Loads workspace HTML artifacts through the bridge and prepares them for
// sandboxed iframe previews: stat/read the document, then inline its local
// CSS/JS/media assets so the preview renders without a web server.
// Called by BridgeStore.loadHtmlArtifactPreview; depends on core path helpers only.
import type { FsReadResp, FsStatResp } from '../../core/workspace';
import { isHtmlWorkspacePath } from '../../core/workspacePaths';

const HTML_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
const HTML_CACHE_LIMIT = 12;

/** Narrow bridge surface the preview pipeline needs (BridgeStore satisfies it). */
export interface ArtifactPreviewBridge {
  readonly isOnline: boolean;
  readonly client: {
    request<T = unknown>(op: string, data: unknown): Promise<T>;
  };
}

export interface HtmlArtifactPreviewContent {
  html: string;
  size: number;
}

export type HtmlArtifactPreviewResult =
  | { status: 'ready'; html: string; size: number }
  | { status: 'error'; reason: string };

const htmlCache = new Map<string, HtmlArtifactPreviewContent>();
const inflightLoads = new Map<string, Promise<HtmlArtifactPreviewResult>>();

function cacheGet(path: string): HtmlArtifactPreviewContent | undefined {
  const value = htmlCache.get(path);
  if (!value) return undefined;
  htmlCache.delete(path);
  htmlCache.set(path, value);
  return value;
}

function cacheSet(path: string, value: HtmlArtifactPreviewContent): void {
  if (htmlCache.has(path)) htmlCache.delete(path);
  htmlCache.set(path, value);
  while (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest === undefined) break;
    htmlCache.delete(oldest);
  }
}

/** Synchronous cache peek so the UI can render a cached preview immediately. */
export function peekHtmlArtifactPreview(path: string): HtmlArtifactPreviewContent | undefined {
  return cacheGet(path);
}

/**
 * Load (or reuse) the prepared preview HTML for a workspace artifact.
 * Deduplicates concurrent loads per path and caches the prepared result.
 */
export async function loadHtmlArtifactPreview(
  bridge: ArtifactPreviewBridge,
  path: string,
): Promise<HtmlArtifactPreviewResult> {
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

async function loadHtmlArtifactUncached(
  bridge: ArtifactPreviewBridge,
  path: string,
): Promise<HtmlArtifactPreviewResult> {
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

async function prepareHtmlForPreview(bridge: ArtifactPreviewBridge, path: string, html: string): Promise<string> {
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

async function inlineStylesheets(bridge: ArtifactPreviewBridge, htmlPath: string, doc: Document): Promise<void> {
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

async function inlineMediaAssets(bridge: ArtifactPreviewBridge, htmlPath: string, doc: Document): Promise<void> {
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

async function inlineScripts(bridge: ArtifactPreviewBridge, htmlPath: string, doc: Document): Promise<void> {
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

export const __artifactPreviewTestApi = {
  reset: () => {
    htmlCache.clear();
    inflightLoads.clear();
  },
  set: (path: string, value: HtmlArtifactPreviewContent) => cacheSet(path, value),
  has: (path: string) => htmlCache.has(path),
  size: () => htmlCache.size,
  limit: HTML_CACHE_LIMIT,
  resolveWorkspaceAssetPath,
  mimeForWorkspaceAsset,
};

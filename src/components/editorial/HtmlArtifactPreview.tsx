import { useEffect, useState, type MouseEvent } from 'react';
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
              srcDoc={state.html}
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
        srcDoc={html}
        sandbox={HTML_SANDBOX}
      />
    </div>
  );
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
    const value = { html: read.content, size: read.size };
    cacheSet(path, value);
    return { status: 'ready', ...value };
  } catch {
    return { status: 'error', reason: 'Preview unavailable. Open in OS to view this artifact.' };
  }
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
};

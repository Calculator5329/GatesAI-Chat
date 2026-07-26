// Inline preview + full-screen modal for HTML artifacts that live in the
// workspace, read on demand through the bridge store facade (the
// stat/read/asset-inlining pipeline lives in services/bridge/artifactPreview).
// Rendered by the markdown layer.
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  applyHtmlArtifactDocumentPolicy,
  HTML_ARTIFACT_IFRAME_SANDBOX,
} from '../../core/htmlArtifactPolicy';
import { isHtmlWorkspacePath } from '../../core/workspacePaths';
import { useDockStore, useEditorial } from '../../stores/context';
import type { HtmlArtifactPreviewResult } from '../../stores/BridgeStore';

type HtmlLoadState = { status: 'loading' } | HtmlArtifactPreviewResult;

type PreviewDocumentUrl = { url: string; revoke?: () => void };

export { isHtmlWorkspacePath };

export function InlineHtmlDocument({ html }: { html: string }) {
  const previewDocument = useMemo(() => createPreviewDocumentUrl(html), [html]);
  useEffect(() => () => previewDocument.revoke?.(), [previewDocument]);

  return (
    <div className="inline-html-preview" data-testid="inline-html-preview">
      <iframe
        title="HTML code preview"
        src={previewDocument.url}
        sandbox={HTML_ARTIFACT_IFRAME_SANDBOX}
      />
    </div>
  );
}

export function isCompleteHtmlDocument(html: string): boolean {
  return /<html(?:\s|>)[\s\S]*<\/html\s*>/i.test(html.trim());
}

/** The document's `<title>`, or null when it has none worth showing. */
export function htmlDocumentTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title || null;
}

/**
 * Transcript form of a complete fenced HTML document. Like the workspace
 * artifact card it announces the document and hands off — the code stays
 * readable below it and the rendering happens somewhere with room (a new
 * tab). Embedding the sandboxed frame here meant every fenced document
 * punched a clamp(260px, 44vw, 420px) white slab into a dark transcript.
 *
 * Not the dock: this HTML only exists in the message, and the dock addresses
 * content by workspace path or artifact id — and is desktop-only, so Web Lite
 * would be left with nothing.
 */
export function InlineHtmlDocumentCard({ html }: { html: string }) {
  const title = htmlDocumentTitle(html);
  const lineCount = html.split('\n').length;

  return (
    <div className="html-document-card" data-testid="inline-html-document-card">
      <div className="html-document-card__meta">
        <span className="html-document-card__eyebrow">HTML document</span>
        <span className="html-document-card__name">{title ?? 'Untitled document'}</span>
        <span className="html-document-card__detail">
          {lineCount === 1 ? '1 line' : `${lineCount} lines`} · opens in a new tab
        </span>
      </div>
      <div className="html-document-card__actions">
        <button type="button" className="html-artifact-preview__open" onClick={() => openHtmlDocument(html)}>
          Open
        </button>
        <button type="button" className="html-artifact-preview__open" onClick={() => downloadHtmlDocument(html)}>
          Download
        </button>
      </div>
    </div>
  );
}

export function openHtmlDocument(html: string): void {
  const previewDocument = createPreviewDocumentUrl(html);
  const opened = window.open(previewDocument.url, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  // Blob URLs must remain alive long enough for the new tab to load.
  if (previewDocument.revoke) window.setTimeout(previewDocument.revoke, 60_000);
}

export function downloadHtmlDocument(html: string, filename = 'artifact.html'): void {
  const previewDocument = createDownloadDocumentUrl(html);
  const anchor = document.createElement('a');
  anchor.href = previewDocument.url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (previewDocument.revoke) window.setTimeout(previewDocument.revoke, 0);
}

/**
  * `panel` renders the sandboxed preview and is what the dock uses.
  * `inline` is the transcript form: it announces the artifact and hands off
  * rather than embedding a 420px frame per mention of a workspace HTML path,
  * which meant naming a file twice built two walls.
  *
  * The compact card always offers "View" (the full-screen modal), which is
  * the one surface both runtimes have. On desktop it additionally hands off
  * to the dock — the persistent surface, which already auto-opens on
  * creation — and clicking the card body prefers it. Web Lite has no dock
  * (`DockStore.available` is desktop-only), so there the card is modal-only
  * rather than growing an "Open in dock" button that does nothing.
  */
export function HtmlArtifactPreview({ path, label, variant = 'panel' }: {
  path: string;
  label?: string;
  variant?: 'inline' | 'panel';
}) {
  const { bridge } = useEditorial();
  const dock = useDockStore();
  /** Compact chrome: bar only, no embedded frame. */
  const compact = variant === 'inline';
  /** Whether the compact card can hand off to the dock, or must self-serve. */
  const handsOffToDock = compact && dock.available;
  const [state, setState] = useState<HtmlLoadState>(() => {
    const cached = bridge.peekHtmlArtifactPreview(path);
    return cached ? { status: 'ready', ...cached } : { status: 'loading' };
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const name = fileNameFromPath(path);
  const readyHtml = state.status === 'ready' ? state.html : null;
  const previewDocument = useMemo(
    () => readyHtml ? createPreviewDocumentUrl(readyHtml) : null,
    [readyHtml],
  );

  useEffect(() => () => previewDocument?.revoke?.(), [previewDocument]);

  // Every mode needs the HTML in hand: to render a frame, or to open the
  // modal that "View" offers. Repeated mentions of one path share a single
  // read through the artifactPreview cache.
  useEffect(() => {
    let cancelled = false;
    void bridge.loadHtmlArtifactPreview(path).then(next => {
      if (!cancelled) setState(next);
    });
    return () => { cancelled = true; };
  }, [bridge, path]);

  function openOs(event: MouseEvent): void {
    event.stopPropagation();
    void bridge.openWorkspacePath(path);
  }

  function runDocumentAction(event: MouseEvent, action: () => void): void {
    event.stopPropagation();
    action();
  }

  function activate(): void {
    if (handsOffToDock) { dock.openPath(path); return; }
    if (state.status === 'ready') setFullscreen(true);
  }

  return (
    <>
      <span
        className="html-artifact-preview"
        role="button"
        tabIndex={0}
        title={handsOffToDock ? `Open ${path} in the dock` : `Preview ${path}`}
        data-variant={variant}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        }}
      >
        <span className="html-artifact-preview__bar">
          <span className="html-artifact-preview__meta">
            <span className="html-artifact-preview__eyebrow">HTML artifact</span>
            <span className="html-artifact-preview__name">{label || name}</span>
            <code className="html-artifact-preview__path">{path}</code>
          </span>
          <span className="html-artifact-preview__actions">
            {handsOffToDock && (
              <button
                type="button"
                className="html-artifact-preview__open"
                onClick={(event) => runDocumentAction(event, () => dock.openPath(path))}
              >
                Open in dock
              </button>
            )}
            {/* Always rendered, disabled until the read lands: a button that
                pops into an otherwise-settled transcript shifts the layout
                under the reader's cursor. */}
            {compact && (
              <button
                type="button"
                className="html-artifact-preview__open"
                disabled={state.status !== 'ready'}
                onClick={(event) => runDocumentAction(event, () => setFullscreen(true))}
              >
                View
              </button>
            )}
            {!compact && state.status === 'ready' && (
              <>
                <button
                  type="button"
                  className="html-artifact-preview__open"
                  onClick={(event) => runDocumentAction(event, () => setView(current => current === 'preview' ? 'source' : 'preview'))}
                >
                  {view === 'preview' ? 'Source' : 'Preview'}
                </button>
                <button type="button" className="html-artifact-preview__open" onClick={(event) => runDocumentAction(event, () => openHtmlDocument(state.html))}>
                  Open
                </button>
                <button type="button" className="html-artifact-preview__open" onClick={(event) => runDocumentAction(event, () => downloadHtmlDocument(state.html, name))}>
                  Download
                </button>
              </>
            )}
            <button type="button" className="html-artifact-preview__open" onClick={openOs}>
              Open in OS
            </button>
          </span>
        </span>
        {!compact && <span className="html-artifact-preview__frame">
          {state.status === 'ready' && view === 'preview' ? (
            <iframe
              title={`Preview of ${label || name}`}
              src={previewDocument?.url}
              sandbox={HTML_ARTIFACT_IFRAME_SANDBOX}
              loading="lazy"
            />
          ) : state.status === 'ready' ? (
            <span className="html-artifact-preview__source"><code>{state.html}</code></span>
          ) : (
            <span className="html-artifact-preview__fallback">
              {state.status === 'loading' ? 'Loading preview...' : state.reason}
            </span>
          )}
        </span>}
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
          <button type="button" className="html-artifact-fullscreen__action" onClick={onOpenOs}>Open in OS</button>
          <button type="button" className="html-artifact-fullscreen__action" aria-label="Close HTML preview" onClick={onClose}>Close</button>
        </div>
      </div>
      <iframe
        title={`Fullscreen preview of ${name}`}
        src={previewDocument.url}
        sandbox={HTML_ARTIFACT_IFRAME_SANDBOX}
      />
    </div>
  );
}

function createPreviewDocumentUrl(html: string): PreviewDocumentUrl {
  return createDocumentUrl(applyHtmlArtifactDocumentPolicy(html));
}

function createDownloadDocumentUrl(html: string): PreviewDocumentUrl {
  return createDocumentUrl(html);
}

function createDocumentUrl(html: string): PreviewDocumentUrl {
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

function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  return clean.split('/').filter(Boolean).pop() || 'artifact.html';
}

// Cache/pipeline test hooks live in services/bridge/artifactPreview
// (__artifactPreviewTestApi); this covers the component-level bits.
export const __htmlArtifactPreviewTestApi = {
  sandbox: HTML_ARTIFACT_IFRAME_SANDBOX,
  createPreviewDocumentUrl,
  createDownloadDocumentUrl,
};

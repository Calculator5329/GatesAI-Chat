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
import { useEditorial } from '../../stores/context';
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

export function HtmlArtifactPreview({ path, label }: { path: string; label?: string }) {
  const { bridge } = useEditorial();
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
          <span className="html-artifact-preview__actions">
            {state.status === 'ready' && (
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
        <span className="html-artifact-preview__frame">
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

// Read-only workspace file viewer for the dock: markdown through the
// existing markdown renderer, JSON pretty-printed with per-key disclosure,
// HTML in the shared sandboxed iframe (InlineHtmlDocument — same policy as
// HtmlArtifactPreview), everything else in a <pre>. Reads go through the
// BridgeStore facade; errors render in-panel (and are logged by the facade).
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { classifyDockFile } from '../../core/dock';
import { useBridgeStore, useUiStore } from '../../stores/context';
import { InlineHtmlDocument } from '../editorial/HtmlArtifactPreview';
import { MarkdownChunk } from '../editorial/MarkdownChunk';
import type { DockPanelProps } from './panelRegistry';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error'; reason: string };

export const FileViewerPanel = observer(function FileViewerPanel({ params }: DockPanelProps) {
  const bridge = useBridgeStore();
  const ui = useUiStore();
  const path = params.path ?? '';
  const bridgeOnline = bridge.isOnline;
  const [state, setState] = useState<LoadState>({ status: 'idle' });

  useEffect(() => {
    if (!path) {
      setState({ status: 'error', reason: 'No file selected.' });
      return;
    }
    // Bridge startup is asynchronous; wait for the online transition instead
    // of caching the initial offline read as a permanent failure.
    if (!bridgeOnline) {
      setState({ status: 'loading' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void bridge.readWorkspaceTextFile(path).then(result => {
      if (cancelled) return;
      setState(result.ok
        ? { status: 'ready', content: result.content }
        : { status: 'error', reason: result.reason });
    });
    return () => { cancelled = true; };
  }, [bridge, bridgeOnline, path]);

  if (state.status !== 'ready') {
    return (
      <div className="dock-panel__notice" data-testid="dock-file-viewer-notice">
        {state.status === 'error' ? state.reason : 'Loading file...'}
      </div>
    );
  }

  const kind = classifyDockFile(path);
  if (kind === 'markdown') {
    return (
      <div className="dock-file-viewer dock-file-viewer--markdown md-body" data-testid="dock-file-viewer-markdown">
        <MarkdownChunk
          content={state.content}
          bridge={bridge}
          lineNumbers={ui.codeLineNumbers}
          onLineNumbersChange={ui.setCodeLineNumbers}
        />
      </div>
    );
  }
  if (kind === 'json') {
    return (
      <div className="dock-file-viewer dock-file-viewer--json" data-testid="dock-file-viewer-json">
        <JsonView content={state.content} />
      </div>
    );
  }
  if (kind === 'html') {
    return (
      <div className="dock-file-viewer dock-file-viewer--html" data-testid="dock-file-viewer-html">
        <InlineHtmlDocument html={state.content} />
      </div>
    );
  }
  return (
    <div className="dock-file-viewer dock-file-viewer--text" data-testid="dock-file-viewer-text">
      <pre>{state.content}</pre>
    </div>
  );
});

/**
 * v1 JSON presentation: a top-level object gets one `<details>` per key so
 * large blobs stay scannable; anything else (array, primitive, invalid JSON)
 * falls back to a pretty-printed / raw `<pre>`.
 */
function JsonView({ content }: { content: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <pre>{content}</pre>;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return <pre>{'{}'}</pre>;
    return (
      <div className="dock-json-view">
        {entries.map(([key, value]) => (
          <details key={key} open={entries.length <= 4}>
            <summary><code>{key}</code></summary>
            <pre>{JSON.stringify(value, null, 2)}</pre>
          </details>
        ))}
      </div>
    );
  }
  return <pre>{JSON.stringify(parsed, null, 2)}</pre>;
}

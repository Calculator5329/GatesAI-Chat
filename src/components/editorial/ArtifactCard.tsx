import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useArtifactStore, useBridgeStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';
import type { ArtifactMeta } from '../../core/artifacts';
import { artifactVersionPath } from '../../core/artifacts';
import {
  handleArtifactBridgeRequest,
  ARTIFACT_PREAMBLE,
  type BridgeRequest,
} from './artifactBridge';

interface ArtifactCardProps {
  id: string;
  version: number;
}

/**
 * Renders an HTML artifact (a self-contained little app the model produced)
 * inside a sandboxed iframe. The iframe is sandboxed with `allow-scripts`
 * and `allow-popups` only — no same-origin, no top-navigation. We inject a
 * preamble (`window.gates`) that lets the artifact talk to the host via
 * `postMessage`; we forward those calls to the workspace bridge.
 *
 * `Open in browser` and `Download .html` give the user an escape hatch out
 * of the chat surface: open the on-disk file with the OS default handler,
 * or save a base64 data URL to disk via an anchor tag.
 */
export const ArtifactCard = observer(function ArtifactCard({ id, version }: ArtifactCardProps) {
  const artifacts = useArtifactStore();
  const bridge = useBridgeStore();
  const [meta, setMeta] = useState<ArtifactMeta | null>(() => artifacts.findById(id));
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(meta == null);
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await artifacts.hydrate(id);
      if (cancelled) return;
      if (!m) { setMissing(true); setLoading(false); return; }
      setMeta(m);
      const h = await artifacts.getHtml(id, version);
      if (cancelled) return;
      setHtml(h);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, version, artifacts]);

  useEffect(() => {
    const handler = makeArtifactMessageHandler(
      id,
      bridge,
      () => fullscreenIframeRef.current ?? iframeRef.current,
    );
    function onMsg(ev: MessageEvent) { void handler(ev); }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id, bridge]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { ev.preventDefault(); setExpanded(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const srcdoc = useMemo(() => (html != null ? ARTIFACT_PREAMBLE + html : ''), [html]);

  if (missing) {
    return (
      <div style={{ ...rectBase, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
        Lost track of artifact <code style={{ marginLeft: 6 }}>{id}</code>
      </div>
    );
  }

  if (loading || !meta) {
    return (
      <div style={{ ...rectBase, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
        Loading artifact…
      </div>
    );
  }

  const downloadHref = html != null
    ? `data:text/html;base64,${utf8ToBase64(srcdoc)}`
    : '#';
  const downloadName = `${meta.slug || 'artifact'}-v${version}.html`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={titleStyle} title={meta.title}>{meta.title}</div>
          <span style={pillStyle}>v{version}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={inlineBtn} onClick={() => setExpanded(true)}>Expand</button>
          <button
            type="button"
            style={inlineBtn}
            onClick={() => { void bridge.openWorkspacePath(artifactVersionPath(id, version)); }}
          >
            Open in browser
          </button>
          <a
            href={downloadHref}
            download={downloadName}
            style={{ ...inlineBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            Download .html
          </a>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        title={meta.title}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-popups"
        style={iframeStyle}
      />
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${meta.title} (full screen)`}
          data-testid="artifact-fullscreen"
          onClick={() => setExpanded(false)}
          style={overlayStyle}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close"
            title="Close"
            style={overlayCloseBtn}
          >×</button>
          <iframe
            ref={fullscreenIframeRef}
            title={`${meta.title} (full screen)`}
            srcDoc={srcdoc}
            sandbox="allow-scripts allow-popups"
            onClick={(e) => e.stopPropagation()}
            style={fullscreenIframeStyle}
          />
        </div>
      )}
    </div>
  );
});

/**
 * Pure factory for the `message` listener so we can unit-test the routing
 * logic without spinning up a real iframe + jsdom postMessage roundtrip.
 * Returns a handler that:
 *   - ignores frames missing `__gates: true`
 *   - ignores frames whose `source` is not the artifact iframe's contentWindow
 *   - forwards everything else through `handleArtifactBridgeRequest` and
 *     posts a `__gatesResp`-tagged response back to that contentWindow.
 */
export function makeArtifactMessageHandler(
  artifactId: string,
  bridge: BridgeStore | undefined,
  getIframe: () => HTMLIFrameElement | null,
) {
  return async function onMessage(ev: MessageEvent): Promise<void> {
    const data = ev.data as BridgeRequest & { __gates?: boolean } | null | undefined;
    if (!data || !data.__gates) return;
    const iframe = getIframe();
    const target = iframe?.contentWindow;
    if (!target || ev.source !== target) return;
    const resp = await handleArtifactBridgeRequest(artifactId, bridge, {
      id: data.id,
      op: data.op,
      args: data.args,
    });
    target.postMessage({ __gatesResp: true, ...resp }, '*');
  };
}

function utf8ToBase64(s: string): string {
  // btoa() can't handle multi-byte UTF-8; route through TextEncoder.
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const rectBase: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  height: 420,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface-soft, rgba(0,0,0,0.04))',
};

const iframeStyle: React.CSSProperties = {
  width: '100%',
  height: 420,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface, #fff)',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 320,
};

const pillStyle: React.CSSProperties = {
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '2px 7px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text-dim)',
  background: 'var(--surface-soft, rgba(0,0,0,0.04))',
  flexShrink: 0,
};

const inlineBtn: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: 12,
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-dim)',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.88)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const overlayCloseBtn: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 20,
  width: 36,
  height: 36,
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(0,0,0,0.5)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 20,
  cursor: 'pointer',
  zIndex: 1001,
};

const fullscreenIframeStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  borderRadius: 8,
  background: '#fff',
};

import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../stores/context';
import { isWebLite } from '../../core/runtime';
import { tokens } from '../../core/styleTokens';

/**
 * Tiny status indicator at the bottom of the sidebar. Three states:
 *
 *  - online  — green dot + "workspace ready"
 *  - offline — red dot + "bridge offline"
 *  - unknown — dim dot + "checking…" (only for the first ~second)
 *
 * Click to force-poll. The store auto-polls every 5s anyway, but a
 * manual nudge is useful right after starting the bridge so the user
 * doesn't have to wait.
 */
export const BridgeStatusPill = observer(function BridgeStatusPill() {
  const { bridge } = useEditorial();
  const webLite = isWebLite();

  let dotColor = 'var(--text-faint)';
  let labelColor = 'var(--accent)';
  let label = 'checking…';
  let title = 'Polling gatesai-bridge…';
  if (webLite) {
    dotColor = 'var(--status-blue)';
    labelColor = 'var(--status-blue-text)';
    label = 'web lite';
    title = 'Firebase/Web Lite mode. Desktop workspace tools and local runtimes are unavailable in the browser.';
  } else if (bridge.state === 'online') {
    dotColor = 'var(--success)';
    labelColor = 'var(--accent)';
    label = 'workspace ready';
    const root = bridge.workspaceRoot ? `\n${bridge.workspaceRoot}` : '';
    title = `Bridge ${bridge.version ?? ''} online.${root}\n${bridge.allowlist.length} allowlisted commands.\nClick to re-poll.`;
  } else if (bridge.state === 'offline' || bridge.state === 'incompatible') {
    dotColor = 'var(--danger-muted)';
    labelColor = 'var(--danger-soft)';
    label = bridge.state === 'incompatible' ? 'bridge update required' : 'bridge offline';
    title = bridge.state === 'incompatible'
      ? `${bridge.lastError ?? 'Bridge protocol mismatch'}\n\nClick to re-poll after updating.`
      : `${bridge.lastError ?? 'No connection'}\n\nStart with: gatesai-bridge\n(see ../gatesai-bridge/README.md)\n\nClick to re-poll.`;
  }

  return (
    <div
      className="bridge-status-pill"
      onClick={() => { if (!webLite) void bridge.poll(); }}
      onKeyDown={event => {
        if (webLite || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        void bridge.poll();
      }}
      title={title}
      style={S.root}
      role={webLite ? 'status' : 'button'}
      tabIndex={webLite ? undefined : 0}
      aria-disabled={webLite || undefined}
    >
      <span style={{ ...S.dot, background: dotColor }} />
      <span className="bridge-status-pill__label" style={{ ...S.label, color: labelColor }}>{label}</span>
    </div>
  );
});

const S: Record<string, CSSProperties> = {
  root: {
    margin: '8px 16px 16px',
    padding: '6px 8px',
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
    display: 'flex', alignItems: 'center', gap: 8,
    cursor: 'pointer',
    fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.02em',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
  },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
    flex: 'none',
    transition: `background-color ${tokens.motion.fade}`,
  },
  label: {
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
};

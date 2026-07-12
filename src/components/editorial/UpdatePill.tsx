import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useUpdateStore } from '../../stores/context';
import { tokens } from '../../core/styleTokens';

/**
 * Non-blocking update prompt above the bridge pill. Renders nothing until
 * the UpdateStore has something to say:
 *
 *  - available  — "v4.6.0 available — click to update"
 *  - installing — progress while the payload downloads
 *  - ready      — "restart to finish updating" (click relaunches)
 *  - error      — the failure reason; click retries the install
 *
 * The × on the right dismisses the pill until the next check finds a
 * (possibly newer) update again.
 */
export const UpdatePill = observer(function UpdatePill() {
  const updates = useUpdateStore();
  if (!updates.visible) return null;

  let label: string;
  let title: string;
  let onClick: (() => void) | null = null;
  if (updates.phase === 'available') {
    label = `v${updates.version} available — update`;
    title = `A new version is ready to download.${updates.notes ? `\n\n${updates.notes}` : ''}\nClick to download and install in the background.`;
    onClick = () => { void updates.install(); };
  } else if (updates.phase === 'installing') {
    const pct = updates.progress != null ? ` ${Math.round(updates.progress * 100)}%` : '';
    label = `downloading update…${pct}`;
    title = `Downloading v${updates.version}. The app keeps working; you'll restart when it's ready.`;
  } else if (updates.phase === 'ready') {
    label = 'restart to finish updating';
    title = `v${updates.version} is staged. Click to restart now, or keep working and restart later.`;
    onClick = () => { void updates.restart(); };
  } else {
    label = 'update failed — retry';
    title = `${updates.error ?? 'Unknown error'}\n\nClick to retry the download.`;
    onClick = () => { void updates.install(); };
  }

  return (
    <div className="update-pill" style={S.root} title={title} role="status">
      <span style={{ ...S.dot, background: updates.phase === 'error' ? 'var(--danger-muted)' : 'var(--status-blue)' }} />
      <span
        className="update-pill__label"
        style={{ ...S.label, cursor: onClick ? 'pointer' : 'default' }}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick ?? undefined}
        onKeyDown={event => {
          if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onClick();
        }}
      >
        {label}
      </span>
      <button
        type="button"
        aria-label="Dismiss update notice"
        style={S.dismiss}
        onClick={() => updates.dismiss()}
      >
        ×
      </button>
    </div>
  );
});

const S: Record<string, CSSProperties> = {
  root: {
    margin: '8px 16px 0',
    padding: '6px 8px',
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.02em',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
  },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
    flex: 'none',
    transition: `background-color ${tokens.motion.fade}`,
  },
  label: {
    flex: 1,
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    color: 'var(--status-blue-text)',
  },
  dismiss: {
    flex: 'none',
    border: 0, background: 'transparent', padding: '0 2px',
    color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
  },
};

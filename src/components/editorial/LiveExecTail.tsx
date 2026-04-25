import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import type { ExecStreamStore } from '../../stores/ExecStreamStore';

/**
 * Renders the most recently-started in-flight `terminal` job below the
 * tool call that triggered it. We pick "most recent" because the model
 * almost always issues one terminal call at a time per turn, and pairing
 * by id is overkill when the relationship is 1:1.
 *
 * Shows the last 10 lines of stdout/stderr in monospace, with a quiet
 * pulsing cursor on the bottom row. When the job finishes, the store
 * lingers it for ~10s then clears it; this component just disappears
 * once the job is gone (and the real ToolResultView takes over).
 */
export const LiveExecTail = observer(function LiveExecTail({ store }: { store: ExecStreamStore }) {
  const jobs = Object.values(store.jobs);
  const running = jobs.filter(j => j.status === 'running');
  if (running.length === 0) return null;
  const job = running.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));

  const cmdline = [job.cmd, ...job.args].join(' ');
  return (
    <div style={S.root}>
      <div style={S.header}>
        <span className="thinking-dots" aria-hidden="true">
          <span /><span /><span />
        </span>
        <span>{cmdline}</span>
      </div>
      <pre style={S.body}>
        {job.tail.length === 0
          ? <span style={S.placeholder}>(no output yet)</span>
          : job.tail.map((line, i) => (
              <span
                key={i}
                style={{ color: line.stream === 'stderr' ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                {line.text}
              </span>
            ))}
        <span className="stream-caret" />
      </pre>
    </div>
  );
});

const S: Record<string, CSSProperties> = {
  root: {
    margin: '6px 0 12px',
    padding: '8px 10px 8px 12px',
    borderLeft: '2px solid var(--accent)',
    background: 'rgba(232,169,72,0.03)',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    fontSize: 11,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    marginBottom: 6,
    color: 'var(--accent)',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    fontSize: 10,
  },
  body: {
    margin: 0,
    color: 'var(--text-dim)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 180,
    overflow: 'hidden',
  },
  placeholder: {
    fontStyle: 'italic', opacity: 0.5,
  },
};

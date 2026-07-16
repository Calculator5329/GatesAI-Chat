import type { CSSProperties } from 'react';
import { Button } from '../ui';

export interface OllamaPullSnapshot {
  percent: number;
  phase: string;
  error?: string;
}

export type OllamaPullViewState = 'idle' | 'pulling' | 'failed' | 'done';

interface OllamaPullStateInput {
  installed: boolean;
  pulling: boolean;
  snapshot?: OllamaPullSnapshot;
}

export function resolveOllamaPullViewState({
  installed,
  pulling,
  snapshot,
}: OllamaPullStateInput): OllamaPullViewState {
  // The catalog is authoritative. It may refresh while a stale failure or
  // progress snapshot remains, so an installed model always wins.
  if (installed) return 'done';
  if (pulling) return 'pulling';
  if (snapshot?.error && /cancel/i.test(`${snapshot.phase} ${snapshot.error}`)) return 'idle';
  if (snapshot?.error) return 'failed';
  if (snapshot && (snapshot.percent >= 100 || /^(success|complete|installed)$/i.test(snapshot.phase.trim()))) {
    return 'done';
  }
  return 'idle';
}

export function OllamaPullStatus({
  model,
  installed,
  pulling,
  snapshot,
  style,
}: OllamaPullStateInput & { model: string; style?: CSSProperties }) {
  const state = resolveOllamaPullViewState({ installed, pulling, snapshot });
  const percent = state === 'done' ? 100 : Math.max(0, Math.min(100, snapshot?.percent ?? 0));

  if (state === 'idle') {
    return <span data-ollama-pull-state="idle" />;
  }

  const failed = state === 'failed';
  const label = failed
    ? friendlyPullError(snapshot?.error)
    : state === 'done'
      ? 'Installed'
      : `${snapshot?.phase || 'Starting pull'} · ${Math.round(percent)}%`;

  return (
    <div
      data-ollama-pull-state={state}
      style={{ marginTop: 7, display: 'grid', gap: 4, minWidth: 140, ...style }}
    >
      {(state === 'pulling' || snapshot) && (
        <div
          role="progressbar"
          aria-label={`Pulling ${model}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          style={{ height: 5, borderRadius: 999, background: 'var(--surface-wash-8)', overflow: 'hidden' }}
        >
          <div style={{
            height: '100%',
            width: `${percent}%`,
            background: failed ? 'var(--danger)' : 'var(--accent)',
            transition: 'width 160ms ease',
          }} />
        </div>
      )}
      <div
        role={failed ? 'alert' : 'status'}
        style={{ fontSize: 11, color: failed ? 'var(--danger)' : state === 'done' ? 'var(--accent)' : 'var(--text-faint)' }}
      >
        {state === 'done' ? '✓ ' : ''}{label}
      </div>
    </div>
  );
}

export function OllamaPullAction({
  model,
  online,
  installed,
  pulling,
  snapshot,
  onPull,
  onCancel,
  pullLabel = 'Pull',
}: OllamaPullStateInput & {
  model: string;
  online: boolean;
  onPull: () => void;
  onCancel: () => void;
  pullLabel?: string;
}) {
  const state = resolveOllamaPullViewState({ installed, pulling, snapshot });
  if (state === 'done') return null;
  if (state === 'pulling') {
    return <Button variant="danger" onClick={onCancel}>Cancel</Button>;
  }
  return (
    <Button
      variant="accent"
      disabled={!online || !model.trim()}
      title={!online ? 'Start Ollama first.' : undefined}
      onClick={onPull}
    >
      {state === 'failed' ? 'Retry' : pullLabel}
    </Button>
  );
}

function friendlyPullError(error: string | undefined): string {
  if (!error) return 'Pull failed. Try again.';
  if (/failed to fetch|network|econnrefused|connection refused|load failed/i.test(error)) {
    return "Couldn't reach Ollama. Make sure it is running, then retry.";
  }
  return error;
}

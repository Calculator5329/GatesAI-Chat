// Aurora pack: the working indicator — a pixel grid that shimmers while the
// assistant is busy, with a live elapsed readout.
// Rendered by AuroraActivityStream and the Aurora composer status.
// Invariant: presentation only; the caller owns whether work is actually live.
import { useEffect, useState } from 'react';

const CELL_COUNT = 9;

/**
 * Elapsed seconds since `startedAt`, ticking only while `active`. Kept local
 * so a finished row stops scheduling timers.
 */
export function useElapsedSeconds(active: boolean, startedAt: number): number {
  const [seconds, setSeconds] = useState(() => Math.max(0, (Date.now() - startedAt) / 1000));
  useEffect(() => {
    if (!active) return;
    // The first sample comes from the interval rather than the effect body:
    // 100ms of staleness is invisible, a cascading render is not.
    const id = window.setInterval(() => {
      setSeconds(Math.max(0, (Date.now() - startedAt) / 1000));
    }, 100);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return seconds;
}

export function AuroraLoader({
  label,
  startedAt,
  active = true,
  showElapsed = true,
}: {
  label: string;
  /** Omitted when the caller has no start time; the elapsed readout is then hidden. */
  startedAt?: number;
  active?: boolean;
  showElapsed?: boolean;
}) {
  const seconds = useElapsedSeconds(active && startedAt !== undefined, startedAt ?? 0);
  const elapsedVisible = showElapsed && startedAt !== undefined;
  return (
    <div className="aurora-loader" data-active={active} role="status" aria-live="polite">
      <span className="aurora-loader__grid" aria-hidden="true">
        {Array.from({ length: CELL_COUNT }, (_, index) => (
          <span key={index} style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </span>
      <span className="aurora-loader__label">{label}</span>
      {elapsedVisible && <span className="aurora-loader__elapsed">{seconds.toFixed(1)}s</span>}
    </div>
  );
}

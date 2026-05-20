// Renders the editorial chat ThreadTitle surface and its local interaction state.
// Called by EditorialChat, EditorialMessage, or the sidebar shell; depends on RootStore hooks, core message types, and UI primitives.
// Invariant: persisted chat state stays in stores while components derive view state from props/hooks.
import { useEffect, useRef, useState } from 'react';

/**
 * Renders a thread title with two modes:
 *
 *  - Idle (`naming` false): static text — unless the title was *just* set
 *    by the auto-namer, in which case we run a one-shot typewriter
 *    animation typing the new title left-to-right at ~22ms per char.
 *
 *  - Naming (`naming` true): a quiet "thinking dots" indicator stands in
 *    for the title until the namer completes.
 *
 * The animation is keyed off the naming → idle transition, observed
 * inside an effect (refs / state stay out of render).
 */
export function ThreadTitle({ title, naming }: { title: string; naming: boolean }) {
  const prevNaming = useRef(naming);
  const [animTarget, setAnimTarget] = useState<string | null>(null);
  const [animProgress, setAnimProgress] = useState(0);

  // Detect naming → idle transitions in an effect, not during render.
  useEffect(() => {
    if (prevNaming.current && !naming && title) {
      setAnimTarget(title);
      setAnimProgress(0);
    }
    prevNaming.current = naming;
  }, [naming, title]);

  // Drive the per-character typewriter once a target is set. Clears
  // itself when finished, with a brief tail so the caret breathes.
  useEffect(() => {
    if (animTarget == null) return;
    const handle = setInterval(() => {
      setAnimProgress(p => {
        const next = p + 1;
        if (next >= animTarget.length) {
          clearInterval(handle);
          setTimeout(() => setAnimTarget(null), 400);
        }
        return next;
      });
    }, 22);
    return () => clearInterval(handle);
  }, [animTarget]);

  if (naming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.6 }}>
        <span className="thinking-dots" aria-hidden="true">
          <span /><span /><span />
        </span>
      </span>
    );
  }

  if (animTarget != null) {
    return (
      <span>
        {animTarget.slice(0, animProgress)}
        <span className="stream-caret" />
      </span>
    );
  }

  return <>{title}</>;
}

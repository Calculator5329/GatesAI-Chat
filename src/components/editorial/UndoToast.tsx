import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRootStore } from '../../stores/context';

const TOAST_TIMEOUT_MS = 5000;
/** Must match the transition on .undo-toast in editorial.css. */
const TOAST_EXIT_MS = 160;

export function UndoToast() {
  const root = useRootStore();
  const snapshot = useSyncExternalStore(
    root.undo.subscribe,
    root.undo.getSnapshot,
    root.undo.getSnapshot,
  );
  const [dismissedEventId, setDismissedEventId] = useState(0);
  // The toast used to appear and vanish with no motion at all, which is jarring
  // for something that shows up unannounced in peripheral vision. The phase is
  // tagged with the event it belongs to, so a newly-raised toast is "not yet
  // shown" by derivation rather than by resetting state inside the effect.
  const [phase, setPhase] = useState<{ eventId: number; state: 'in' | 'leaving' }>(
    { eventId: -1, state: 'in' },
  );

  useEffect(() => {
    if (snapshot.event === null || snapshot.event === 'cleared') return;
    const eventId = snapshot.eventId;
    const raf = requestAnimationFrame(() => setPhase({ eventId, state: 'in' }));
    const leaveTimer = setTimeout(() => setPhase({ eventId, state: 'leaving' }), TOAST_TIMEOUT_MS);
    const goneTimer = setTimeout(() => setDismissedEventId(eventId), TOAST_TIMEOUT_MS + TOAST_EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(leaveTimer);
      clearTimeout(goneTimer);
    };
  }, [snapshot.event, snapshot.eventId]);

  const shown = phase.eventId === snapshot.eventId && phase.state === 'in';

  if (dismissedEventId === snapshot.eventId || snapshot.event === null || snapshot.event === 'cleared') {
    return null;
  }

  const undoLast = (): void => {
    if (!root.undo.undo() || root.router.isMenu) return;
    root.router.goThread(root.chat.activeThreadId);
  };

  return (
    <div
      className="undo-toast"
      role="status"
      aria-live="polite"
      data-shown={shown ? 'true' : undefined}
    >
      <span className="undo-toast__message">
        {snapshot.event === 'undone' ? 'Undone' : snapshot.nextLabel}
      </span>
      {snapshot.event === 'registered' && snapshot.canUndo && (
        <button type="button" className="undo-toast__button" onClick={undoLast}>Undo</button>
      )}
    </div>
  );
}

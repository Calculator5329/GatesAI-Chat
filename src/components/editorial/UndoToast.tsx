import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRootStore } from '../../stores/context';

const TOAST_TIMEOUT_MS = 5000;

export function UndoToast() {
  const root = useRootStore();
  const snapshot = useSyncExternalStore(
    root.undo.subscribe,
    root.undo.getSnapshot,
    root.undo.getSnapshot,
  );
  const [dismissedEventId, setDismissedEventId] = useState(0);

  useEffect(() => {
    if (snapshot.event === null || snapshot.event === 'cleared') return;
    const eventId = snapshot.eventId;
    const timer = setTimeout(() => setDismissedEventId(eventId), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [snapshot.event, snapshot.eventId]);

  if (dismissedEventId === snapshot.eventId || snapshot.event === null || snapshot.event === 'cleared') {
    return null;
  }

  const undoLast = (): void => {
    if (!root.undo.undo() || root.router.isMenu) return;
    root.router.goThread(root.chat.activeThreadId);
  };

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span className="undo-toast__message">
        {snapshot.event === 'undone' ? 'Undone' : snapshot.nextLabel}
      </span>
      {snapshot.event === 'registered' && snapshot.canUndo && (
        <button type="button" className="undo-toast__button" onClick={undoLast}>Undo</button>
      )}
    </div>
  );
}

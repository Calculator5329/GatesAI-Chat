// Draft-mirroring hook for the composer. It decouples the textarea's visual
// value from the MobX store: typing updates local state instantly (no
// observers fire), and a trailing debounce mirrors to ui.setDraft so the
// ContextMeter and other observers see at most ~8 updates/second while typing.
// Local state resyncs from ui.draft when it changes externally (thread switch,
// programmatic clear after send).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { UiStore } from '../../../stores/UiStore';
import { DRAFT_FLUSH_MS, SUPPORTS_FIELD_SIZING } from './composerStyles';

export interface ComposerDraft {
  /** The live textarea value (local, un-debounced). */
  value: string;
  /** Mirror a keystroke locally and schedule the debounced store flush. */
  onDraftChange: (next: string) => void;
  /** Flush the pending value to the store immediately (blur / unmount). */
  flushDraft: () => void;
  /** Drop any pending debounce without flushing (used right before send). */
  cancelPendingFlush: () => void;
  /** Clear draft + local state after a successful send, resetting height. */
  resetDraftAfterSend: () => void;
}

export function useComposerDraft(
  ui: UiStore,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): ComposerDraft {
  const [localDraft, setLocalDraft] = useState(ui.draft);
  const localDraftRef = useRef(localDraft);
  localDraftRef.current = localDraft;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDraft = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (ui.draft !== localDraftRef.current) {
      ui.setDraft(localDraftRef.current);
    }
  }, [ui]);

  // Resync when the store changes externally (thread switch, send-clear, etc.)
  useEffect(() => {
    if (ui.draft !== localDraftRef.current) {
      setLocalDraft(ui.draft);
    }
  }, [ui.draft]);

  // Flush on unmount.
  useEffect(() => {
    return () => { flushDraft(); };
  }, [flushDraft]);

  const onDraftChange = useCallback((next: string) => {
    setLocalDraft(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (ui.draft !== localDraftRef.current) ui.setDraft(localDraftRef.current);
    }, DRAFT_FLUSH_MS);
  }, [ui]);

  const cancelPendingFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const resetDraftAfterSend = useCallback(() => {
    ui.clearDraft();
    setLocalDraft('');
    if (!SUPPORTS_FIELD_SIZING && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [ui, textareaRef]);

  return { value: localDraft, onDraftChange, flushDraft, cancelPendingFlush, resetDraftAfterSend };
}

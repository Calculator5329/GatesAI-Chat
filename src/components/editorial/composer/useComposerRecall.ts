// Keyboard adapter for composer history. The state machine itself lives in
// composerRecall.ts; this hook only enforces textarea eligibility and applies
// its chosen value through the draft hook.
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import {
  IDLE_COMPOSER_RECALL,
  interruptRecall,
  recallNext,
  recallPrevious,
  restoreRecallDraft,
  type ComposerRecallState,
} from './composerRecall';

interface UseComposerRecallArgs {
  threadId: string | null;
  messages: readonly string[];
  value: string;
  replaceDraft: (next: string) => void;
}

export function useComposerRecall({
  threadId,
  messages,
  value,
  replaceDraft,
}: UseComposerRecallArgs) {
  const stateRef = useRef<ComposerRecallState>(IDLE_COMPOSER_RECALL);

  // A recalled prompt never crosses conversations.
  useEffect(() => {
    stateRef.current = IDLE_COMPOSER_RECALL;
  }, [threadId]);

  const onDraftChange = useCallback((next: string, setDraft: (value: string) => void) => {
    // Once the user edits a recalled value, it becomes an ordinary draft.
    // Arrow keys and Escape must not discard that edit.
    if (stateRef.current.index !== null) stateRef.current = interruptRecall(stateRef.current);
    setDraft(next);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const textarea = event.currentTarget;
    let result;
    if (event.key === 'ArrowUp') {
      const canEnterRecall = value.length === 0
        && textarea.selectionStart === 0
        && textarea.selectionEnd === 0;
      if (stateRef.current.index === null && !canEnterRecall) return false;
      result = recallPrevious(messages, stateRef.current, value);
    } else if (event.key === 'ArrowDown') {
      result = recallNext(messages, stateRef.current, value);
    } else if (event.key === 'Escape') {
      result = restoreRecallDraft(stateRef.current, value);
    } else {
      return false;
    }
    if (!result.handled) return false;
    event.preventDefault();
    stateRef.current = result.state;
    replaceDraft(result.value);
    return true;
  }, [messages, replaceDraft, value]);

  const cancelRecall = useCallback(() => {
    stateRef.current = interruptRecall(stateRef.current);
  }, []);

  return { onDraftChange, onKeyDown, cancelRecall };
}

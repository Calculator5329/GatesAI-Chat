// Pure composer-history transitions. Keeping the state machine independent of
// React lets the hook remain a thin keyboard adapter and makes recall behavior
// straightforward to test.
export interface ComposerRecallState {
  /** Index into oldest-to-newest sent prompt bodies, or null when idle. */
  index: number | null;
  /** Draft present before entering history; Escape and Down-after-latest restore it. */
  draftBeforeRecall: string;
}

export interface ComposerRecallResult {
  handled: boolean;
  state: ComposerRecallState;
  value: string;
}

export const IDLE_COMPOSER_RECALL: ComposerRecallState = {
  index: null,
  draftBeforeRecall: '',
};

export function recallPrevious(
  messages: readonly string[],
  state: ComposerRecallState,
  draft: string,
): ComposerRecallResult {
  if (messages.length === 0) return { handled: false, state, value: draft };
  const index = state.index === null ? messages.length - 1 : Math.max(0, state.index - 1);
  return {
    handled: true,
    state: {
      index,
      draftBeforeRecall: state.index === null ? draft : state.draftBeforeRecall,
    },
    value: messages[index],
  };
}

export function recallNext(
  messages: readonly string[],
  state: ComposerRecallState,
  draft: string,
): ComposerRecallResult {
  if (state.index === null) return { handled: false, state, value: draft };
  if (state.index >= messages.length - 1) {
    return {
      handled: true,
      state: IDLE_COMPOSER_RECALL,
      value: state.draftBeforeRecall,
    };
  }
  const index = state.index + 1;
  return {
    handled: true,
    state: { ...state, index },
    value: messages[index],
  };
}

export function restoreRecallDraft(state: ComposerRecallState, draft: string): ComposerRecallResult {
  if (state.index === null) return { handled: false, state, value: draft };
  return {
    handled: true,
    state: IDLE_COMPOSER_RECALL,
    value: state.draftBeforeRecall,
  };
}

/** A typed edit takes ownership of the recalled value as an ordinary draft. */
export function interruptRecall(_state: ComposerRecallState): ComposerRecallState {
  return IDLE_COMPOSER_RECALL;
}

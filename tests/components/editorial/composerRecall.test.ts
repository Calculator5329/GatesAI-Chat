import { describe, expect, it } from 'vitest';
import {
  IDLE_COMPOSER_RECALL,
  interruptRecall,
  recallNext,
  recallPrevious,
  restoreRecallDraft,
} from '../../../src/components/editorial/composer/composerRecall';

describe('composer recall state machine', () => {
  const messages = ['first prompt', 'second prompt', 'latest prompt'];

  it('walks backwards with Up and forwards with Down, then restores the draft', () => {
    let result = recallPrevious(messages, IDLE_COMPOSER_RECALL, 'unsent draft');
    expect(result).toMatchObject({ handled: true, value: 'latest prompt', state: { index: 2, draftBeforeRecall: 'unsent draft' } });

    result = recallPrevious(messages, result.state, result.value);
    expect(result.value).toBe('second prompt');
    result = recallPrevious(messages, result.state, result.value);
    expect(result.value).toBe('first prompt');
    result = recallPrevious(messages, result.state, result.value);
    expect(result.value).toBe('first prompt');

    result = recallNext(messages, result.state, result.value);
    expect(result.value).toBe('second prompt');
    result = recallNext(messages, result.state, result.value);
    expect(result.value).toBe('latest prompt');
    result = recallNext(messages, result.state, result.value);
    expect(result).toMatchObject({ handled: true, value: 'unsent draft', state: IDLE_COMPOSER_RECALL });
  });

  it('stops navigating when editing interrupts recall', () => {
    const recalled = recallPrevious(messages, IDLE_COMPOSER_RECALL, '');
    const edited = 'latest prompt, revised';
    const afterEdit = recallNext(messages, interruptRecall(recalled.state), edited);

    expect(recalled.state.index).toBe(2);
    expect(afterEdit).toEqual({ handled: false, state: IDLE_COMPOSER_RECALL, value: edited });
  });

  it('restores the pre-recall draft with Escape', () => {
    const recalled = recallPrevious(messages, IDLE_COMPOSER_RECALL, 'keep this draft');
    const restored = restoreRecallDraft(recalled.state, recalled.value);

    expect(restored).toEqual({ handled: true, state: IDLE_COMPOSER_RECALL, value: 'keep this draft' });
  });
});

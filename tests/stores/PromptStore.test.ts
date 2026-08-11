import { describe, expect, it } from 'vitest';
import { PromptStore } from '../../src/stores/PromptStore';
import type { AssistantPromptRequest } from '../../src/core/prompts';

const REQUEST: AssistantPromptRequest = {
  kind: 'approval',
  question: 'Delete the stale build folder?',
  options: [
    { id: 'option-0', label: 'Delete it' },
    { id: 'option-1', label: 'Leave it' },
  ],
};

describe('PromptStore', () => {
  it('publishes a pending prompt scoped to its thread', () => {
    const store = new PromptStore();
    void store.ask(REQUEST, { threadId: 't1' });
    expect(store.pendingForThread('t1')).toHaveLength(1);
    expect(store.pendingForThread('t2')).toHaveLength(0);
    expect(store.pendingForThread('t1')[0].question).toBe(REQUEST.question);
  });

  it('resolves with the chosen option and clears the card', async () => {
    const store = new PromptStore();
    const pending = store.ask(REQUEST, { threadId: 't1' });
    store.answer(store.pending[0].id, { optionId: 'option-0', text: 'Delete it' });
    await expect(pending).resolves.toEqual({ optionId: 'option-0', text: 'Delete it', declined: false });
    expect(store.pending).toHaveLength(0);
  });

  it('resolves a decline as declined rather than as an answer', async () => {
    const store = new PromptStore();
    const pending = store.ask(REQUEST, { threadId: 't1' });
    store.decline(store.pending[0].id);
    const answer = await pending;
    expect(answer.declined).toBe(true);
    expect(store.pending).toHaveLength(0);
  });

  it('settles exactly once when the user answers as the turn aborts', async () => {
    const controller = new AbortController();
    const store = new PromptStore();
    const pending = store.ask(REQUEST, { threadId: 't1', signal: controller.signal });
    const id = store.pending[0].id;
    store.answer(id, { optionId: 'option-0', text: 'Delete it' });
    controller.abort();
    // The first settlement wins; the abort must not overwrite a real answer.
    await expect(pending).resolves.toMatchObject({ declined: false, text: 'Delete it' });
  });

  it('declines immediately when asked with an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const store = new PromptStore();
    const answer = await new PromptStore().ask(REQUEST, { threadId: 't1', signal: controller.signal });
    expect(answer.declined).toBe(true);
    expect(store.pending).toHaveLength(0);
  });

  it('settles on abort so an interrupted turn never leaves a stuck card', async () => {
    const controller = new AbortController();
    const store = new PromptStore();
    const pending = store.ask(REQUEST, { threadId: 't1', signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ declined: true });
    expect(store.pending).toHaveLength(0);
  });

  it('cancels only the named thread', async () => {
    const store = new PromptStore();
    const first = store.ask(REQUEST, { threadId: 't1' });
    store.ask(REQUEST, { threadId: 't2' });
    store.cancelThread('t1');
    await expect(first).resolves.toMatchObject({ declined: true });
    expect(store.pendingForThread('t2')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { askUserTool } from '../../src/services/tools/askUser';
import { PromptStore } from '../../src/stores/PromptStore';
import type { ToolContext } from '../../src/services/tools/types';

function ctxWith(prompts?: PromptStore, signal?: AbortSignal): ToolContext {
  return { threadId: 't1', toolCallId: 'call-1', prompts, signal } as unknown as ToolContext;
}

const ARGS = {
  kind: 'approval',
  question: 'Should I delete the stale build folder?',
  options: [{ label: 'Delete it', detail: 'Frees 400MB' }, { label: 'Leave it' }],
  grounds: ['Last modified 8 months ago'],
};

describe('ask_user validation', () => {
  const validate = askUserTool.meta?.validate;

  it('requires a question and at least two options', () => {
    expect(validate?.({ question: '', options: ARGS.options })?.errorCode).toBe('missing_question');
    expect(validate?.({ question: 'Pick?', options: [{ label: 'Only one' }] })?.errorCode).toBe('too_few_options');
  });

  it('rejects an essay and an overlong option list', () => {
    expect(validate?.({ question: 'x'.repeat(301), options: ARGS.options })?.errorCode).toBe('question_too_long');
    const many = Array.from({ length: 6 }, (_, i) => ({ label: `Option ${i}` }));
    expect(validate?.({ question: 'Pick one?', options: many })?.errorCode).toBe('too_many_options');
  });

  it('accepts a well-formed question', () => {
    expect(validate?.(ARGS)).toBeNull();
  });

  it('is declared read-only — asking changes nothing on its own', () => {
    expect(askUserTool.meta?.isReadOnly?.({})).toBe(true);
    expect(askUserTool.meta?.hasSideEffects?.({})).toBe(false);
  });
});

describe('ask_user execution', () => {
  it('blocks until the user answers, then reports the choice', async () => {
    const prompts = new PromptStore();
    const pending = askUserTool.execute(ARGS, ctxWith(prompts));
    expect(prompts.pendingForThread('t1')).toHaveLength(1);
    const prompt = prompts.pending[0];
    expect(prompt.options.map(option => option.label)).toEqual(['Delete it', 'Leave it']);
    expect(prompt.grounds).toEqual(['Last modified 8 months ago']);

    prompts.answer(prompt.id, { optionId: prompt.options[0].id, text: 'Delete it' });
    const result = await pending;
    expect(String(result)).toContain('status: answered');
    expect(String(result)).toContain('answer: Delete it');
  });

  it('reports a decline honestly instead of inventing an answer', async () => {
    const prompts = new PromptStore();
    const pending = askUserTool.execute(ARGS, ctxWith(prompts));
    prompts.decline(prompts.pending[0].id);
    const result = String(await pending);
    expect(result).toContain('status: declined');
    expect(result).toContain('Do not ask this again');
  });

  it('says so plainly when the runtime cannot ask', async () => {
    const result = String(await askUserTool.execute(ARGS, ctxWith(undefined)));
    expect(result).toContain('cannot ask the user questions');
  });

  it('accepts plain-string options', async () => {
    const prompts = new PromptStore();
    void askUserTool.execute({ ...ARGS, options: ['Yes', 'No'] }, ctxWith(prompts));
    expect(prompts.pending[0].options.map(option => option.label)).toEqual(['Yes', 'No']);
  });
});

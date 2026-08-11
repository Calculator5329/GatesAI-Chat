// Owns the questions the assistant is currently blocked on.
// Called by the ask_user tool (through a ToolContext facade) and rendered by
// the chat surface; depends on core prompt contracts only.
// Invariant: every pending prompt has exactly one resolver, and every exit
// path — answer, decline, abort, thread cancel — settles it exactly once. A
// leaked resolver would hang the assistant turn forever.
import { action, makeAutoObservable, observable } from 'mobx';
import type {
  AssistantPrompt,
  AssistantPromptAnswer,
  AssistantPromptRequest,
} from '../core/prompts';
import { declinedAnswer } from '../core/prompts';

let promptSequence = 0;

export class PromptStore {
  pending: AssistantPrompt[] = [];
  /** Resolvers are plain callbacks, deliberately outside the observable graph. */
  private readonly resolvers = new Map<string, (answer: AssistantPromptAnswer) => void>();

  constructor() {
    makeAutoObservable<this, 'resolvers'>(this, {
      pending: observable,
      resolvers: false,
      answer: action.bound,
      decline: action.bound,
    });
  }

  pendingForThread(threadId: string): AssistantPrompt[] {
    return this.pending.filter(prompt => prompt.threadId === threadId);
  }

  /**
   * Publishes a question and resolves once the user answers it. An aborted
   * turn settles as a decline so the tool round can finish cleanly instead of
   * leaving a card the user can never clear.
   */
  ask(
    request: AssistantPromptRequest,
    meta: { threadId: string; toolCallId?: string; signal?: AbortSignal },
  ): Promise<AssistantPromptAnswer> {
    if (meta.signal?.aborted) {
      return Promise.resolve(declinedAnswer('The turn was interrupted before the user answered.'));
    }
    promptSequence += 1;
    const prompt: AssistantPrompt = {
      id: `prompt-${Date.now()}-${promptSequence}`,
      kind: request.kind,
      threadId: meta.threadId,
      question: request.question,
      context: request.context,
      options: request.options,
      grounds: request.grounds,
      allowFreeText: request.allowFreeText ?? false,
      createdAt: Date.now(),
      toolCallId: meta.toolCallId,
    };
    return new Promise<AssistantPromptAnswer>(resolve => {
      this.resolvers.set(prompt.id, resolve);
      this.pending.push(prompt);
      meta.signal?.addEventListener(
        'abort',
        () => this.settle(prompt.id, declinedAnswer('The turn was interrupted before the user answered.')),
        { once: true },
      );
    });
  }

  answer(promptId: string, answer: { optionId?: string; text: string }): void {
    this.settle(promptId, { optionId: answer.optionId, text: answer.text, declined: false });
  }

  decline(promptId: string): void {
    this.settle(promptId, declinedAnswer('The user declined to answer.'));
  }

  /** Clears anything still waiting in a thread (thread deleted, turn stopped). */
  cancelThread(threadId: string, reason = 'The user stopped this turn.'): void {
    for (const prompt of this.pending.filter(item => item.threadId === threadId)) {
      this.settle(prompt.id, declinedAnswer(reason));
    }
  }

  private settle(promptId: string, answer: AssistantPromptAnswer): void {
    const resolve = this.resolvers.get(promptId);
    // A prompt can be settled twice (user answers as the turn aborts); the
    // first settlement wins and the rest are no-ops.
    if (!resolve) return;
    this.resolvers.delete(promptId);
    this.pending = this.pending.filter(prompt => prompt.id !== promptId);
    resolve(answer);
  }
}

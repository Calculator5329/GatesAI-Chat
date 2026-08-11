// Defines the assistant-prompt contract: a question the model asks the user
// mid-turn and blocks on. Called by PromptStore, the ask_user tool, and the
// cards that render it; depends on nothing.
// Invariant: a prompt is always answerable — the UI must offer a way to
// decline, because a tool call is waiting on the answer and a prompt nobody
// can dismiss would wedge the turn.

export type AssistantPromptKind =
  /** "May I do X?" — asked before acting. */
  | 'approval'
  /** "I suggest X." — a proposal with alternatives the user can take or leave. */
  | 'recommendation';

export interface AssistantPromptOption {
  id: string;
  label: string;
  /** One line of why this option, shown under the label. */
  detail?: string;
}

export interface AssistantPrompt {
  id: string;
  kind: AssistantPromptKind;
  threadId: string;
  /** The question itself, one sentence. */
  question: string;
  /** Optional detail: what exactly would happen, in plain language. */
  context?: string;
  options: AssistantPromptOption[];
  /**
   * What the model is going on — sources, tool results, prior turns. Shown
   * verbatim in place of a confidence meter: the app cannot measure a model's
   * confidence, so it reports the grounds instead of inventing a number.
   */
  grounds?: string[];
  /** Whether the user may answer with their own words instead of an option. */
  allowFreeText: boolean;
  createdAt: number;
  toolCallId?: string;
}

export interface AssistantPromptAnswer {
  /** Chosen option, when the user picked one. */
  optionId?: string;
  /** Free text the user typed, or the label of the chosen option. */
  text: string;
  /** True when the user dismissed the question instead of answering it. */
  declined: boolean;
}

export interface AssistantPromptRequest {
  kind: AssistantPromptKind;
  question: string;
  context?: string;
  options: AssistantPromptOption[];
  grounds?: string[];
  allowFreeText?: boolean;
}

/** The answer produced when a prompt is cancelled rather than answered. */
export function declinedAnswer(reason: string): AssistantPromptAnswer {
  return { text: reason, declined: true };
}

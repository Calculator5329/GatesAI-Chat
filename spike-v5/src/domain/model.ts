// Domain values for one chat conversation. Pure data plus pure transitions:
// no I/O, no globals, no observability framework, no DOM. Everything here is
// immutable — a transition returns a new Conversation rather than mutating one.
//
// This is the innermost ring of the v5 layering: transport and persistence
// adapters may depend on this file, and it depends on nothing.

export type ConversationId = string & { readonly __brand: 'ConversationId' };
export type MessageId = string & { readonly __brand: 'MessageId' };

export const conversationId = (value: string): ConversationId => value as ConversationId;
export const messageId = (value: string): MessageId => value as MessageId;

export type Role = 'system' | 'user' | 'assistant';

/** Why an assistant message stopped producing text. */
export type StopReason = 'complete' | 'length' | 'cancelled' | 'error';

export interface UserMessage {
  readonly kind: 'user';
  readonly id: MessageId;
  readonly role: 'user';
  readonly text: string;
  readonly createdAt: number;
}

export interface AssistantMessage {
  readonly kind: 'assistant';
  readonly id: MessageId;
  readonly role: 'assistant';
  readonly text: string;
  readonly createdAt: number;
  readonly modelId: string;
  /** Absent while the message is still streaming. */
  readonly stoppedAt?: number;
  readonly stopReason?: StopReason;
  readonly error?: string;
  readonly usage?: TokenUsage;
}

export type Message = UserMessage | AssistantMessage;

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly title: string;
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
  readonly updatedAt: number;
}

export function createConversation(input: {
  id: ConversationId;
  modelId: string;
  systemPrompt: string;
  title?: string;
  now: number;
}): Conversation {
  return {
    id: input.id,
    title: input.title ?? 'New conversation',
    modelId: input.modelId,
    systemPrompt: input.systemPrompt,
    messages: [],
    updatedAt: input.now,
  };
}

/** True when the last message is an assistant message that has not stopped. */
export function isStreaming(conversation: Conversation): boolean {
  const last = conversation.messages.at(-1);
  return last?.kind === 'assistant' && last.stopReason === undefined;
}

export function appendUserMessage(
  conversation: Conversation,
  input: { id: MessageId; text: string; now: number },
): Conversation {
  const text = input.text.trim();
  if (!text) throw new DomainError('empty-user-message', 'A user message needs text.');
  if (isStreaming(conversation)) {
    throw new DomainError('turn-in-flight', 'The previous assistant turn has not stopped.');
  }
  const message: UserMessage = {
    kind: 'user',
    id: input.id,
    role: 'user',
    text,
    createdAt: input.now,
  };
  return {
    ...conversation,
    title: conversation.messages.length === 0 ? deriveTitle(text) : conversation.title,
    messages: [...conversation.messages, message],
    updatedAt: input.now,
  };
}

export function beginAssistantMessage(
  conversation: Conversation,
  input: { id: MessageId; modelId: string; now: number },
): Conversation {
  const last = conversation.messages.at(-1);
  if (last?.kind !== 'user') {
    throw new DomainError('no-user-turn', 'An assistant reply must follow a user message.');
  }
  const message: AssistantMessage = {
    kind: 'assistant',
    id: input.id,
    role: 'assistant',
    text: '',
    createdAt: input.now,
    modelId: input.modelId,
  };
  return { ...conversation, messages: [...conversation.messages, message], updatedAt: input.now };
}

export function appendAssistantText(
  conversation: Conversation,
  input: { id: MessageId; delta: string; now: number },
): Conversation {
  return mapAssistant(conversation, input.id, input.now, message => {
    if (message.stopReason !== undefined) {
      throw new DomainError('message-stopped', 'Cannot append to a stopped assistant message.');
    }
    return { ...message, text: message.text + input.delta };
  });
}

export function stopAssistantMessage(
  conversation: Conversation,
  input: {
    id: MessageId;
    reason: StopReason;
    now: number;
    error?: string;
    usage?: TokenUsage;
  },
): Conversation {
  return mapAssistant(conversation, input.id, input.now, message => {
    if (message.stopReason !== undefined) return message;
    return {
      ...message,
      stoppedAt: input.now,
      stopReason: input.reason,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
    };
  });
}

/** The message list a provider is asked to continue, system prompt first. */
export function promptMessages(
  conversation: Conversation,
): readonly { role: Role; content: string }[] {
  const history = conversation.messages
    .filter(message => message.kind === 'user' || message.text.length > 0)
    .map(message => ({ role: message.role as Role, content: message.text }));
  const system = conversation.systemPrompt.trim();
  return system ? [{ role: 'system' as const, content: system }, ...history] : history;
}

export type DomainErrorCode =
  | 'empty-user-message'
  | 'turn-in-flight'
  | 'no-user-turn'
  | 'message-stopped'
  | 'unknown-message'
  | 'unknown-conversation';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

function mapAssistant(
  conversation: Conversation,
  id: MessageId,
  now: number,
  update: (message: AssistantMessage) => AssistantMessage,
): Conversation {
  let found = false;
  const messages = conversation.messages.map(message => {
    if (message.id !== id || message.kind !== 'assistant') return message;
    found = true;
    return update(message);
  });
  if (!found) throw new DomainError('unknown-message', `No assistant message ${id}.`);
  return { ...conversation, messages, updatedAt: now };
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine || 'New conversation';
}

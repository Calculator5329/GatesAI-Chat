// The vertical slice: one user message in, one persisted assistant reply out.
//
// This function is the whole application layer for a chat turn. It holds no
// state of its own — the conversation is loaded, transformed by the pure
// transitions in `model.ts`, and handed back to the repository. Nothing here
// knows what HTTP, SSE, IndexedDB, MobX or React are.

import {
  appendAssistantText,
  appendUserMessage,
  beginAssistantMessage,
  messageId as brandMessageId,
  DomainError,
  promptMessages,
  stopAssistantMessage,
  type Conversation,
  type ConversationId,
  type MessageId,
  type StopReason,
  type TokenUsage,
} from './model';
import type { TurnEvent } from './events';
import type {
  ChatTransport,
  Clock,
  CompletionRequest,
  ConversationRepository,
  IdSource,
  TurnListener,
  TurnPlugin,
} from './ports';

export interface TurnDependencies {
  readonly transport: ChatTransport;
  readonly repository: ConversationRepository;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly listeners?: readonly TurnListener[];
  readonly plugins?: readonly TurnPlugin[];
}

export interface TurnInput {
  readonly conversationId: ConversationId;
  readonly text: string;
  readonly signal?: AbortSignal;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface TurnResult {
  readonly conversation: Conversation;
  readonly userMessageId: MessageId;
  readonly assistantMessageId: MessageId;
  readonly text: string;
  readonly stopReason: StopReason;
  readonly error?: string;
  readonly usage?: TokenUsage;
}

export async function runChatTurn(deps: TurnDependencies, input: TurnInput): Promise<TurnResult> {
  const { transport, repository, clock, ids } = deps;
  const emit = createEmitter(deps);
  const signal = input.signal ?? neverAborted();

  const loaded = await repository.load(input.conversationId);
  if (!loaded) {
    throw new DomainError('unknown-conversation', `No conversation ${input.conversationId}.`);
  }

  const userMessageId = brandMessageId(ids.next('msg'));
  let conversation = appendUserMessage(loaded, {
    id: userMessageId,
    text: input.text,
    now: clock.now(),
  });
  emit({
    type: 'turn.started',
    conversationId: conversation.id,
    at: clock.now(),
    userMessageId,
  });

  // Durability before the network call: an interrupted turn must never lose
  // what the user typed. v4 relies on a debounced autosave for this.
  await repository.save(conversation);
  emit({ type: 'conversation.saved', conversationId: conversation.id, at: clock.now(), revision: 1 });

  const assistantMessageId = brandMessageId(ids.next('msg'));
  conversation = beginAssistantMessage(conversation, {
    id: assistantMessageId,
    modelId: conversation.modelId,
    now: clock.now(),
  });
  emit({
    type: 'assistant.started',
    conversationId: conversation.id,
    at: clock.now(),
    messageId: assistantMessageId,
    modelId: conversation.modelId,
  });

  const request = applyPlugins(deps, {
    modelId: conversation.modelId,
    messages: promptMessages(conversation),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
  });

  let stopReason: StopReason = 'error';
  let terminal = false;
  let error: string | undefined;
  let usage: TokenUsage | undefined;

  try {
    for await (const chunk of transport.stream(request, signal)) {
      if (chunk.type === 'text') {
        if (!chunk.delta) continue;
        conversation = appendAssistantText(conversation, {
          id: assistantMessageId,
          delta: chunk.delta,
          now: clock.now(),
        });
        emit({
          type: 'assistant.delta',
          conversationId: conversation.id,
          at: clock.now(),
          messageId: assistantMessageId,
          delta: chunk.delta,
        });
        continue;
      }
      if (chunk.type === 'usage') {
        usage = chunk.usage;
        continue;
      }
      if (chunk.type === 'error') {
        terminal = true;
        stopReason = 'error';
        error = chunk.message;
        break;
      }
      terminal = true;
      stopReason = chunk.finishReason === 'stop' ? 'complete' : chunk.finishReason;
      break;
    }
  } catch (cause) {
    // A transport that throws instead of yielding `error` is still a
    // transport failure, not a crash of the turn.
    stopReason = signal.aborted ? 'cancelled' : 'error';
    error = cause instanceof Error ? cause.message : String(cause);
  }

  if (signal.aborted) stopReason = 'cancelled';
  else if (!terminal && error === undefined) error = 'Transport ended without completion evidence.';

  conversation = stopAssistantMessage(conversation, {
    id: assistantMessageId,
    reason: stopReason,
    now: clock.now(),
    ...(error !== undefined ? { error } : {}),
    ...(usage !== undefined ? { usage } : {}),
  });

  const finalText = assistantText(conversation, assistantMessageId);
  emit({
    type: 'assistant.stopped',
    conversationId: conversation.id,
    at: clock.now(),
    messageId: assistantMessageId,
    reason: stopReason,
    text: finalText,
    ...(error !== undefined ? { error } : {}),
    ...(usage !== undefined ? { usage } : {}),
  });

  // A cancelled or failed turn is persisted exactly like a successful one.
  await repository.save(conversation);
  emit({ type: 'conversation.saved', conversationId: conversation.id, at: clock.now(), revision: 2 });

  return {
    conversation,
    userMessageId,
    assistantMessageId,
    text: finalText,
    stopReason,
    ...(error !== undefined ? { error } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}

function assistantText(conversation: Conversation, id: MessageId): string {
  const message = conversation.messages.find(item => item.id === id);
  return message?.text ?? '';
}

function applyPlugins(deps: TurnDependencies, request: CompletionRequest): CompletionRequest {
  let current = request;
  for (const plugin of deps.plugins ?? []) {
    current = plugin.decorateRequest?.(current) ?? current;
  }
  return current;
}

function createEmitter(deps: TurnDependencies): (event: TurnEvent) => void {
  const listeners = deps.listeners ?? [];
  const plugins = deps.plugins ?? [];
  if (listeners.length === 0 && plugins.length === 0) return () => {};
  return event => {
    for (const listener of listeners) listener(event);
    for (const plugin of plugins) plugin.onEvent?.(event);
  };
}

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

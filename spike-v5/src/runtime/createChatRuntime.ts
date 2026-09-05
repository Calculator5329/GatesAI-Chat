// Composition root. The only file that is allowed to know all three layers
// exist at the same time.
//
// A host application (React, CLI, test) constructs one of these and then
// talks to two methods. Subscribing is how the UI observes a turn; there is
// no host-callback interface to implement.

import { createConversation, conversationId as brandConversationId } from '../domain/model';
import type { Conversation, ConversationId } from '../domain/model';
import type {
  ChatTransport,
  Clock,
  ConversationRepository,
  IdSource,
  TurnListener,
  TurnPlugin,
} from '../domain/ports';
import type { TurnEvent } from '../domain/events';
import { runChatTurn, type TurnResult } from '../domain/runTurn';

export interface ChatRuntimeOptions {
  readonly transport: ChatTransport;
  readonly repository: ConversationRepository;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly plugins?: readonly TurnPlugin[];
  readonly defaultModelId: string;
  readonly defaultSystemPrompt?: string;
}

export interface SendOptions {
  readonly signal?: AbortSignal;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export class ChatRuntime {
  private readonly listeners = new Set<TurnListener>();
  private readonly options: ChatRuntimeOptions;
  private readonly clock: Clock;
  private readonly ids: IdSource;

  // No parameter properties: `erasableSyntaxOnly` is on, so every construct
  // here survives plain type-stripping and the core stays runnable without a
  // TypeScript-aware build step.
  constructor(options: ChatRuntimeOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock();
    this.ids = options.ids ?? randomIds();
  }

  subscribe(listener: TurnListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Creates and persists an empty conversation, returning it. */
  async startConversation(input: { modelId?: string; systemPrompt?: string } = {}): Promise<Conversation> {
    const conversation = createConversation({
      id: brandConversationId(this.ids.next('conv')),
      modelId: input.modelId ?? this.options.defaultModelId,
      systemPrompt: input.systemPrompt ?? this.options.defaultSystemPrompt ?? '',
      now: this.clock.now(),
    });
    await this.options.repository.save(conversation);
    return conversation;
  }

  async send(id: ConversationId, text: string, options: SendOptions = {}): Promise<TurnResult> {
    return runChatTurn(
      {
        transport: this.options.transport,
        repository: this.options.repository,
        clock: this.clock,
        ids: this.ids,
        listeners: [this.fanOut],
        ...(this.options.plugins ? { plugins: this.options.plugins } : {}),
      },
      {
        conversationId: id,
        text,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
      },
    );
  }

  private readonly fanOut = (event: TurnEvent): void => {
    for (const listener of this.listeners) listener(event);
  };
}

export function createChatRuntime(options: ChatRuntimeOptions): ChatRuntime {
  return new ChatRuntime(options);
}

function systemClock(): Clock {
  return { now: () => Date.now() };
}

function randomIds(): IdSource {
  let counter = 0;
  return {
    next: prefix => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`,
  };
}

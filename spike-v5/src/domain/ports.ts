// The seam. Every port is declared by the domain and implemented by an
// adapter outside it, so the dependency arrow always points inward.
//
// A port is only allowed here if a turn genuinely cannot run without it.
// That rule is what the v4 host interfaces lost: `TurnHost` grew to 14
// methods and `TurnRunnerDeps` to 11 more because "things the turn needs"
// and "things the UI needs to react to" were the same interface.

import type { Conversation, ConversationId, TokenUsage } from './model';
import type { TurnEvent } from './events';

/** What the domain asks a provider for. Wire shape is the adapter's problem. */
export interface CompletionRequest {
  readonly modelId: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export type CompletionChunk =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'done'; readonly finishReason: 'stop' | 'length' | 'cancelled' }
  | { readonly type: 'error'; readonly message: string };

/**
 * Transport port: turns a request into a chunk stream. One method, because
 * one method is all a turn needs. Catalog lookups, key storage and health
 * checks are separate concerns and get separate ports if they are ever needed.
 */
export interface ChatTransport {
  readonly id: string;
  stream(request: CompletionRequest, signal: AbortSignal): AsyncIterable<CompletionChunk>;
}

/**
 * Persistence port. Load/save whole conversations: the domain never learns
 * about rows, slots, schema versions or storage keys.
 */
export interface ConversationRepository {
  load(id: ConversationId): Promise<Conversation | undefined>;
  save(conversation: Conversation): Promise<void>;
}

/** Ambient facts, injected so tests are deterministic and the domain is pure. */
export interface Clock {
  now(): number;
}

export interface IdSource {
  next(prefix: string): string;
}

/**
 * The observation seam. The UI subscribes here instead of being wired into
 * the turn as a callback host, and extensions get the same stream the UI does.
 */
export type TurnListener = (event: TurnEvent) => void;

/**
 * Extension seam. `decorateRequest` is the one write hook; everything else an
 * extension can do is read-only observation. Deliberately narrow: an
 * extension API is a compatibility promise, so it starts as the smallest
 * promise that is still worth making.
 */
export interface TurnPlugin {
  readonly name: string;
  decorateRequest?(request: CompletionRequest): CompletionRequest;
  onEvent?(event: TurnEvent): void;
}

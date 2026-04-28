import type { Model } from './types';
import type { LlmMessage, ToolDef } from './llm';
import type { ProviderId } from './llm';

/**
 * Token estimation + context-window lookup.
 *
 * We use a 4-chars-per-token heuristic instead of real tokenizers. Real ones
 * (`tiktoken`, `@anthropic-ai/tokenizer`) add ~1.5MB to the bundle and need
 * wasm; the heuristic is within ~10% for English prose and effectively free.
 * Good enough for a UI meter. If/when we need accurate trim decisions for
 * context-window enforcement, swap `estimateTokens` for a real tokenizer
 * keyed off `providerId` and the rest of the system stays the same.
 */

const CHARS_PER_TOKEN = 4;
/** Per-message overhead (role + JSON envelope) the providers add. */
const MESSAGE_OVERHEAD_TOKENS = 4;
export const DEFAULT_RESERVED_REPLY_TOKENS = 4096;

/** Default context windows by provider, used when `model.contextLength` is unset. */
const DEFAULT_WINDOW_BY_PROVIDER: Record<ProviderId, number> = {
  openrouter: 128_000,
  openai: 128_000,
  anthropic: 200_000,
  gemini: 1_000_000,
  groq: 32_000,
  local: 8_000,
  ollama: 8_000,
  // Synthetic provider — never sent to a tokenizer. Pick a small window so
  // any debug accounting that lands here doesn't allocate megabytes.
  'local-image': 4_000,
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: Array<{ content: string }>): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS;
  return total;
}

export function estimateWireTokens(messages: LlmMessage[], tools: ToolDef[] = []): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += estimateTokens(message.content ?? '');
    if (message.role === 'assistant' && message.toolCalls?.length) {
      total += estimateTokens(JSON.stringify(message.toolCalls));
    }
    if (message.role === 'tool') {
      total += estimateTokens(message.toolCallId ?? '');
      total += estimateTokens(message.toolName ?? '');
    }
  }
  if (tools.length > 0) total += estimateTokens(JSON.stringify(tools));
  return total;
}

export function estimateLlmPayloadTokens(args: {
  systemPrompt?: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  reservedOutputTokens?: number;
}): number {
  const system = args.systemPrompt
    ? estimateTokens(args.systemPrompt) + MESSAGE_OVERHEAD_TOKENS
    : 0;
  return system
    + estimateWireTokens(args.messages, args.tools ?? [])
    + (args.reservedOutputTokens ?? DEFAULT_RESERVED_REPLY_TOKENS);
}

export function contextWindowFor(model: Model | undefined | null): number {
  if (!model) return 32_000;
  if (model.contextLength && model.contextLength > 0) return model.contextLength;
  return DEFAULT_WINDOW_BY_PROVIDER[model.providerId] ?? 32_000;
}

export interface TokenUsage {
  used: number;
  window: number;
  fraction: number;
}

export function computeUsage(used: number, window: number): TokenUsage {
  const safeWindow = window > 0 ? window : 1;
  return { used, window: safeWindow, fraction: Math.min(1, used / safeWindow) };
}

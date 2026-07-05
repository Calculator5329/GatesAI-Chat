// Defines shared tokens domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
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
const TOOL_TOKEN_CACHE_LIMIT = 64;
const toolTokenCache = new Map<string, number>();

/** Default context windows by provider, used when `model.contextLength` is unset. */
const DEFAULT_WINDOW_BY_PROVIDER: Record<ProviderId, number> = {
  openrouter: 128_000,
  'openai-compat': 32_000,
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
  if (tools.length > 0) total += estimateToolTokens(tools);
  return total;
}

export function estimateToolTokens(tools: ToolDef[]): number {
  if (tools.length === 0) return 0;
  const key = tools.map(tool => tool.name).join('|');
  const cached = toolTokenCache.get(key);
  if (cached != null) return cached;
  const value = estimateTokens(JSON.stringify(tools));
  toolTokenCache.set(key, value);
  if (toolTokenCache.size > TOOL_TOKEN_CACHE_LIMIT) {
    const first = toolTokenCache.keys().next().value;
    if (first) toolTokenCache.delete(first);
  }
  return value;
}

export function clearTokenEstimateCaches(): void {
  toolTokenCache.clear();
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
  if (model.contextWindow && model.contextWindow > 0) return model.contextWindow;
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

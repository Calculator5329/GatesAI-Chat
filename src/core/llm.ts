/**
 * Provider-agnostic LLM contract.
 *
 * Every provider implementation in `src/services/llm/` returns an
 * `AsyncIterable<LlmChunk>`. The router maps a `Model.providerId` to the
 * right provider and forwards the request.
 *
 * Cancellation uses a standard `AbortSignal`. Providers MUST honor it and
 * stop yielding on abort.
 */

export type ProviderId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'local';      // OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM, llama.cpp)

export type LlmRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Provider-agnostic message shape sent in `LlmRequest.messages`.
 *
 * - `user` / `assistant` / `system`: text content.
 * - `assistant` may also carry `toolCalls` instead of (or in addition to)
 *   text — the model decided to invoke one or more tools.
 * - `tool`: a tool-execution result echoed back to the model, paired with
 *   `toolCallId` so the provider can match it to the assistant's request.
 */
export interface LlmMessage {
  role: LlmRole;
  content: string;
  toolCalls?: ToolCall[];   // assistant only
  toolCallId?: string;      // tool only
  toolName?: string;        // tool only (some providers want this)
}

/** A function/tool the model is allowed to call. JSON-Schema for parameters. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Minimal JSON-Schema subset we actually use. Loose on purpose. */
export type JsonSchema = {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
};

/** A single tool invocation requested by the model. Arguments are already-parsed JSON. */
export interface ToolCall {
  id: string;                    // provider-supplied id; we echo it back on the result
  name: string;                  // matches a registered tool
  arguments: Record<string, unknown>;
}

export interface LlmRequest {
  modelId: string;          // provider-specific model identifier (e.g. "claude-sonnet-4-5-20250929")
  messages: LlmMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tools the model may call. Omit (or pass []) to disable tool calling. */
  tools?: ToolDef[];
}

/**
 * A single streamed update from the provider.
 *
 * Text streams as `text` chunks. Tool calls stream as a `tool_call` chunk
 * containing the *fully-buffered* call (name + parsed arguments) once the
 * provider has emitted enough of the stream to assemble it. We don't surface
 * argument-deltas to the store/UI yet — keeps the contract small and matches
 * how every provider's tool-call JSON arrives in practice (small, fast).
 */
export type LlmChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason?: 'stop' | 'length' | 'tool_use' | 'cancelled' | 'error'; error?: string };

export interface LlmProvider {
  readonly id: ProviderId;
  /** Whether this provider has everything it needs (e.g. an API key) to run. */
  ready(): boolean;
  /** Stream a chat completion. Must respect `signal.aborted`. */
  stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}

/** Provider-agnostic config (mostly API keys and the local-endpoint URL). */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;          // for OpenAI-compatible local endpoints
}

export type ProviderConfigs = Partial<Record<ProviderId, ProviderConfig>>;

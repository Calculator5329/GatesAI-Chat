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
  | 'ollama'        // Native Ollama server (/api/chat, /api/tags)
  | 'local-image';  // Synthetic provider that bypasses the LLM and sends the
                    // user's prompt directly to the configured local image
                    // backend. No network round-trip required.

export type LlmRole = 'user' | 'assistant' | 'system' | 'tool';

export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

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
  /**
   * Inline image inputs for user messages. Populated just before send
   * by `resolveWireImages` (or equivalent), which reads bytes from the
   * bridge and base64-encodes them. Providers that support vision turn
   * these into their native image block shape; providers that do not
   * simply ignore them.
   */
  images?: LlmImagePart[];
}

/**
 * One image attached to a wire-level user message. Bytes are inline
 * base64 — refs are already resolved by the time the provider sees them.
 */
export interface LlmImagePart {
  mime: string;
  base64: string;
}

/** A function/tool the model is allowed to call. JSON-Schema for parameters. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Provider hint for strict tool-argument schema adherence when supported. */
  strict?: boolean;
}

/** Minimal JSON-Schema subset we validate locally. Loose on purpose so provider/MCP schemas can pass through. */
export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'boolean' | 'array' | string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

/** A single tool invocation requested by the model. Arguments are already-parsed JSON. */
export interface ToolCall {
  id: string;                    // provider-supplied id; we echo it back on the result
  name: string;                  // matches a registered tool
  arguments: Record<string, unknown>;
  /** Set by providers when streamed argument JSON was malformed or unusable. */
  argumentsError?: string;
  /** Short raw argument preview for diagnostics when parsing failed. */
  rawArguments?: string;
}

export interface LlmRequest {
  modelId: string;          // provider-specific model identifier (e.g. "claude-sonnet-4-5-20250929")
  messages: LlmMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tools the model may call. Omit (or pass []) to disable tool calling. */
  tools?: ToolDef[];
  /** Optional provider-normalized reasoning depth for models that support it. */
  thinkingEffort?: ThinkingEffort;
  /** Optional: threadId for diagnostic log routing. Not sent to providers. */
  threadId?: string;
}

export interface LlmUsage {
  providerId?: ProviderId;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Provider-reported charge. OpenRouter reports this as account credits. */
  costUsd?: number;
  /** Where `costUsd` came from, for display and auditing. */
  costSource?: 'provider' | 'pricing' | 'free' | 'local';
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
  | { type: 'usage'; usage: LlmUsage }
  | { type: 'done'; finishReason?: 'stop' | 'length' | 'tool_use' | 'cancelled' | 'content_filter' | 'error'; error?: string };

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
  /** Runtime availability for providers backed by local daemons. */
  available?: boolean;
  /** Ollama-specific: drop tools from every request when false. */
  toolsEnabled?: boolean;
}

export type ProviderConfigs = Partial<Record<ProviderId, ProviderConfig>>;

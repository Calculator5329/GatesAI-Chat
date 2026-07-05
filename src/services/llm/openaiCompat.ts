// Implements LLM provider plumbing for openaiCompat.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, LlmUsage, ProviderId, ToolDef } from '../../core/llm';
import { openAiCompatBodyExtras } from './modelFormatProfiles';
import { ensureOk, parseSse } from './sse';
import { accumulateToolCallDelta, createToolCallDeltaState, finalizeToolCallDeltas, finiteNumber, isRecord, normalizeFinishReason, type StreamFinishReason } from './streamCore';
import { logger } from '../diagnostics/logger';

export interface OpenAiCompatOptions {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey?: string;
  requiresApiKey?: boolean;
  available?: boolean;
  /** Extra headers (e.g. OpenRouter wants HTTP-Referer / X-Title). */
  extraHeaders?: Record<string, string>;
}

interface ChatChoiceDelta {
  content?: string | null;
  tool_calls?: unknown[];
}

interface ChatChunk {
  model?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{
    delta?: ChatChoiceDelta;
    finish_reason?: string | null;
  }>;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

/**
 * Streams a chat completion from an OpenAI-compatible `/chat/completions`
 * endpoint. Used by OpenAI, Groq, OpenRouter, and local servers (Ollama,
 * LM Studio, vLLM, llama.cpp).
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly requiresApiKey: boolean;
  private readonly available: boolean;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: OpenAiCompatOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.requiresApiKey = opts.requiresApiKey ?? true;
    this.available = opts.available !== false;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  ready(): boolean {
    return Boolean(this.baseUrl) && this.available && (!this.requiresApiKey || Boolean(this.apiKey));
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const messages = buildOpenAiMessages({ ...req, messages: this.normalizeMessages(req) });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: req.modelId,
          messages,
          stream: true,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          // Centralized model profiles cap output and add provider quirks.
          ...openAiCompatBodyExtras(req),
          ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
          // `reasoning.max_tokens` — we use max_tokens because it's precise
          ...(req.tools && req.tools.length > 0
            ? { tools: req.tools.map(toOpenAiTool), tool_choice: 'auto' }
            : {}),
        }),
      });
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      const message = (err as Error).message;
      logger.warn('llm', 'Provider stream error', { provider: this.name, modelId: req.modelId, error: message });
      yield { type: 'done', finishReason: 'error', error: message };
      return;
    }

    try {
      await ensureOk(response, this.name);
    } catch (err) {
      const message = (err as Error).message;
      logger.warn('llm', 'Provider stream error', { provider: this.name, modelId: req.modelId, error: message });
      yield { type: 'done', finishReason: 'error', error: message };
      return;
    }

    const pendingToolCalls = createToolCallDeltaState();
    let finishReason: StreamFinishReason | undefined;
    try {
      for await (const data of parseSse(response, signal)) {
        if (data === '[DONE]') break;
        let chunk: ChatChunk;
        try {
          chunk = parseChatChunk(JSON.parse(data));
        } catch {
          continue;
        }
        const usage = parseProviderUsage(chunk.usage, {
          providerId: this.id,
          modelId: chunk.model ?? req.modelId,
        });
        if (usage) yield { type: 'usage', usage };
        const choice = chunk.choices?.[0];

        const textDelta = choice?.delta?.content;
        if (textDelta) yield { type: 'text', delta: textDelta };

        for (const callDelta of choice?.delta?.tool_calls ?? []) {
          accumulateToolCallDelta(pendingToolCalls, callDelta);
        }

        const normalizedFinishReason = normalizeFinishReason(choice?.finish_reason);
        if (normalizedFinishReason) finishReason = normalizedFinishReason;
      }
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    for (const call of finalizeToolCallDeltas(pendingToolCalls)) {
      yield { type: 'tool_call', call };
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }

  protected normalizeMessages(req: LlmRequest): LlmMessage[] {
    return req.messages;
  }
}

function parseChatChunk(value: unknown): ChatChunk {
  if (!isRecord(value)) return {};
  return {
    model: typeof value.model === 'string' ? value.model : undefined,
    usage: parseOpenRouterUsage(value.usage),
    choices: Array.isArray(value.choices) ? value.choices.map(parseChatChoice).filter((choice): choice is NonNullable<ChatChunk['choices']>[number] => choice !== null) : undefined,
  };
}

function parseChatChoice(value: unknown): NonNullable<ChatChunk['choices']>[number] | null {
  if (!isRecord(value)) return null;
  return {
    delta: parseChatChoiceDelta(value.delta),
    finish_reason: typeof value.finish_reason === 'string' || value.finish_reason === null
      ? value.finish_reason
      : undefined,
  };
}

function parseChatChoiceDelta(value: unknown): ChatChoiceDelta | undefined {
  if (!isRecord(value)) return undefined;
  return {
    content: typeof value.content === 'string' || value.content === null ? value.content : undefined,
    tool_calls: Array.isArray(value.tool_calls) ? value.tool_calls : undefined,
  };
}

function parseOpenRouterUsage(value: unknown): OpenRouterUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    prompt_tokens: finiteNumber(value.prompt_tokens),
    completion_tokens: finiteNumber(value.completion_tokens),
    total_tokens: finiteNumber(value.total_tokens),
    cost: finiteNumber(value.cost),
  };
}

function parseProviderUsage(
  usage: OpenRouterUsage | undefined,
  context: Pick<LlmUsage, 'providerId' | 'modelId'>,
): LlmUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const parsed: LlmUsage = { ...context };
  if (typeof usage.prompt_tokens === 'number' && Number.isFinite(usage.prompt_tokens)) {
    parsed.promptTokens = usage.prompt_tokens;
  }
  if (typeof usage.completion_tokens === 'number' && Number.isFinite(usage.completion_tokens)) {
    parsed.completionTokens = usage.completion_tokens;
  }
  if (typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)) {
    parsed.totalTokens = usage.total_tokens;
  }
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
    parsed.costUsd = usage.cost;
  }
  return parsed.promptTokens != null
    || parsed.completionTokens != null
    || parsed.totalTokens != null
    || parsed.costUsd != null
    ? parsed
    : null;
}

function toOpenAiTool(tool: ToolDef): { type: 'function'; function: { name: string; description: string; parameters: unknown; strict?: boolean } } {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.strict && isProviderStrictSchemaSafe(tool.parameters) ? { strict: true } : {}),
    },
  };
}

// Some OpenAI-compatible gateways reject `strict` schemas when optional object
// properties are present. Keep strict mode only where the schema contract is
// fully provider-safe, then let ChatStore validation handle the rest.
function isProviderStrictSchemaSafe(schema: ToolDef['parameters']): boolean {
  if (schema.type !== 'object') return true;
  if (schema.additionalProperties !== false) return false;
  const propertyNames = Object.keys(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  if (propertyNames.some(name => !required.has(name))) return false;
  return Object.values(schema.properties ?? {}).every(child => {
    if (child.type === 'object') return isProviderStrictSchemaSafe(child);
    if (child.type === 'array' && child.items?.type === 'object') return isProviderStrictSchemaSafe(child.items);
    return true;
  });
}

/**
 * Translate our provider-agnostic `LlmMessage[]` into the OpenAI body shape.
 * Assistant messages with `toolCalls` get the `tool_calls` field; `tool`
 * messages map to `{ role: 'tool', tool_call_id, name, content }`.
 */
function buildOpenAiMessages(req: LlmRequest): unknown[] {
  const out: unknown[] = [];
  if (req.systemPrompt) out.push({ role: 'system', content: req.systemPrompt });
  for (const m of req.messages) {
    out.push(toOpenAiMessage(m));
  }
  return out;
}

function toOpenAiMessage(m: LlmMessage): unknown {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: m.toolCallId ?? '',
      name: m.toolName,
      content: m.content,
    };
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      })),
    };
  }
  if (m.role === 'user' && m.images && m.images.length > 0) {
    const parts: unknown[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of m.images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${img.mime};base64,${img.base64}` },
      });
    }
    return { role: 'user', content: parts };
  }
  return { role: m.role, content: m.content };
}

import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, LlmUsage, ProviderId, ToolCall, ToolDef } from '../../core/llm';
import { parseJsonObject } from './json';
import { ensureOk, parseSse } from './sse';

export interface OpenAiCompatOptions {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Extra headers (e.g. OpenRouter wants HTTP-Referer / X-Title). */
  extraHeaders?: Record<string, string>;
}

interface ChatChoiceDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;       // streamed as JSON-string fragments across chunks
    };
  }>;
}

interface ChatChunk {
  model?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{
    delta?: ChatChoiceDelta;
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
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
 *
 * Tool calls: OpenAI streams `delta.tool_calls[]` where each call's
 * `function.arguments` arrives as concatenated JSON-string fragments across
 * many chunks (and across multiple `tool_calls` entries by `index`). We
 * accumulate per-index, then on `finish_reason === 'tool_calls'` (or stream
 * end) parse and emit one `tool_call` chunk per call.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: OpenAiCompatOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  ready(): boolean {
    return Boolean(this.apiKey);
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
          // Always cap reply length. Without this, OpenRouter forwards the
          // model's full output ceiling (e.g. 65k for GPT-5.4 Pro) and its
          // credit pre-check rejects with HTTP 402 unless the caller has
          // enough balance to afford the worst case. 4096 tokens (~16k
          // chars) is plenty for a chat reply; longer outputs should opt in
          // explicitly via `req.maxTokens`.
          max_tokens: req.maxTokens ?? 4096,
          // Gemini 3 (and other reasoning models routed via OpenRouter) burn
          // the entire output budget on hidden "thinking" tokens by default,
          // returning empty text + finish=length. Cap the reasoning budget so
          // visible output always gets at least half the user's `maxTokens`.
          // OpenRouter only accepts ONE of `reasoning.effort` or
          // `reasoning.max_tokens` — we use max_tokens because it's precise
          // and matches our budget math. Other providers ignore unknown fields.
          ...(/(^|\/)gemini-3/i.test(req.modelId)
            ? {
                reasoning: {
                  max_tokens: Math.max(64, Math.floor((req.maxTokens ?? 4096) / 2)),
                },
              }
            : {}),
          ...(req.tools && req.tools.length > 0
            ? { tools: req.tools.map(toOpenAiTool), tool_choice: 'auto' }
            : {}),
        }),
      });
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    try {
      await ensureOk(response, this.name);
    } catch (err) {
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    /** Per-call accumulator keyed by the `index` field OpenAI uses to dedupe call fragments. */
    const pending = new Map<number, { id: string; name: string; argsBuf: string }>();
    let finishReason: 'stop' | 'length' | 'tool_use' | undefined;
    try {
      for await (const data of parseSse(response, signal)) {
        if (data === '[DONE]') break;
        let chunk: ChatChunk;
        try { chunk = JSON.parse(data) as ChatChunk; } catch { continue; }
        const usage = parseProviderUsage(chunk.usage, {
          providerId: this.id,
          modelId: chunk.model ?? req.modelId,
        });
        if (usage) yield { type: 'usage', usage };
        const choice = chunk.choices?.[0];

        const textDelta = choice?.delta?.content;
        if (textDelta) yield { type: 'text', delta: textDelta };

        const callDeltas = choice?.delta?.tool_calls;
        if (callDeltas) {
          for (const cd of callDeltas) {
            const slot = pending.get(cd.index) ?? { id: '', name: '', argsBuf: '' };
            if (cd.id) slot.id = cd.id;
            if (cd.function?.name) slot.name = cd.function.name;
            if (cd.function?.arguments) slot.argsBuf += cd.function.arguments;
            pending.set(cd.index, slot);
          }
        }

        const fr = choice?.finish_reason;
        if (fr === 'stop' || fr === 'length') finishReason = fr;
        else if (fr === 'tool_calls') finishReason = 'tool_use';
      }
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    // Drain accumulated tool calls. Preserve malformed argument JSON so the
    // tool loop can give the model a specific validation error instead of
    // pretending the model intentionally sent `{}`.
    for (const slot of pending.values()) {
      if (!slot.name) continue;
      const parsedArgs = parseJsonObject(slot.argsBuf);
      const call: ToolCall = {
        id: slot.id || `${slot.name}-${Math.random().toString(36).slice(2, 8)}`,
        name: slot.name,
        arguments: parsedArgs.value,
        ...(!parsedArgs.ok ? {
          argumentsError: parsedArgs.error,
          rawArguments: parsedArgs.rawPreview,
        } : {}),
      };
      yield { type: 'tool_call', call };
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }

  protected normalizeMessages(req: LlmRequest): LlmMessage[] {
    return req.messages;
  }
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

function toOpenAiTool(t: ToolDef): { type: 'function'; function: { name: string; description: string; parameters: unknown; strict?: boolean } } {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, ...(t.strict ? { strict: true } : {}) } };
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

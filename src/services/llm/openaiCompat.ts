import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ProviderId, ToolCall, ToolDef } from '../../core/llm';
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
  choices?: Array<{
    delta?: ChatChoiceDelta;
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
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
    return this.id === 'local' ? true : Boolean(this.apiKey);
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

    // Drain accumulated tool calls (parse args as JSON; if parse fails, send empty object so the loop can still respond).
    for (const slot of pending.values()) {
      if (!slot.name) continue;
      const call: ToolCall = {
        id: slot.id || `${slot.name}-${Math.random().toString(36).slice(2, 8)}`,
        name: slot.name,
        arguments: safeJsonObject(slot.argsBuf),
      };
      yield { type: 'tool_call', call };
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }

  protected normalizeMessages(req: LlmRequest): LlmMessage[] {
    return req.messages;
  }
}

function toOpenAiTool(t: ToolDef): { type: 'function'; function: { name: string; description: string; parameters: unknown } } {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
}

function safeJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
  return { role: m.role, content: m.content };
}

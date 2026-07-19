// Implements LLM provider plumbing for ollama.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, LlmUsage, ToolCall, ToolDef } from '../../core/llm';
import { ensureOk } from './sse';
import { finiteNumber, isRecord, normalizeFinishReason, normalizeToolCallArguments, readUtf8Lines, type StreamFinishReason } from './streamCore';
import { logger } from '../diagnostics/logger';
import { resolveModelFormatProfile } from './modelFormatProfiles';

/**
 * Default base URL for a local Ollama daemon. Single source of truth — used
 * by `ollamaStorage` (defaults), `OllamaStore.setBaseUrl` (empty fallback),
 * and `buildProviders` in the router (config absent fallback).
 */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export interface OllamaProviderOptions {
  baseUrl: string;
  apiKey?: string;
  available?: boolean;
  /** When false, drop tools from every request (per-model overrides via supportsTools live in ChatStore). */
  toolsEnabled?: boolean;
}

interface OllamaWireMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    id?: string;
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaStreamFrame {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: unknown[];
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDef['parameters'];
  };
}

/**
 * Ollama provider. Speaks Ollama's native NDJSON `/api/chat` rather than the
 * OpenAI-compatible `/v1/chat/completions` shim because we want:
 *   - the proper streaming tool-call format
 *   - native `keep_alive` so the model isn't reloaded between turns
 *   - native `images` field on user messages (different shape than OpenAI parts)
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly available: boolean;
  private readonly toolsEnabled: boolean;
  private toolCallSeq = 0;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.available = opts.available === true;
    this.toolsEnabled = opts.toolsEnabled !== false;
  }

  ready(): boolean {
    return Boolean(this.baseUrl) && this.available;
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const format = resolveModelFormatProfile(req.modelId);
    const useTools = this.toolsEnabled && req.tools && req.tools.length > 0 && !format.ollama?.disableTools;
    const options: Record<string, unknown> = {};
    if (typeof req.temperature === 'number') {
      options.temperature = req.temperature;
    }
    if (format.ollama?.numCtx != null) {
      options.num_ctx = format.ollama.numCtx;
    }
    if (format.ollama?.stop?.length) {
      options.stop = format.ollama.stop;
    }

    const body = {
      model: req.modelId,
      messages: this.buildMessages(req.messages, req.systemPrompt),
      stream: true,
      keep_alive: '5m',
      ...(req.responseFormat ? { format: req.responseFormat.type === 'json_object' ? 'json' : req.responseFormat.schema } : {}),
      ...(useTools ? { tools: req.tools!.map(toOllamaTool) } : {}),
      ...(Object.keys(options).length ? { options } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      const message = (err as Error).message;
      logger.warn('llm', 'Ollama stream error', { modelId: req.modelId, error: message });
      yield { type: 'done', finishReason: 'error', error: message };
      return;
    }

    try { await ensureOk(response, 'Ollama'); }
    catch (err) {
      const message = (err as Error).message;
      logger.warn('llm', 'Ollama stream error', { modelId: req.modelId, error: message });
      yield { type: 'done', finishReason: 'error', error: message };
      return;
    }

    if (!response.body) {
      yield { type: 'done', finishReason: 'error', error: 'Ollama: empty response body' };
      return;
    }

    yield* this.parseNdjson(response.body, signal, req.modelId);
  }

  private buildMessages(messages: LlmMessage[], systemPrompt: string | undefined): OllamaWireMessage[] {
    const out: OllamaWireMessage[] = [];
    if (systemPrompt && systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      const wire: OllamaWireMessage = { role: m.role, content: m.content };
      if (m.role === 'user' && m.images && m.images.length) {
        wire.images = m.images.map(img => img.base64);
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        wire.tool_calls = m.toolCalls.map(c => ({
          id: c.id,
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      out.push(wire);
    }
    return out;
  }

  private async *parseNdjson(body: ReadableStream<Uint8Array>, signal: AbortSignal, modelId: string): AsyncIterable<LlmChunk> {
    let toolUseSeen = false;

    for await (const line of readUtf8Lines(body, signal)) {
      let frame: OllamaStreamFrame;
      try {
        frame = parseOllamaStreamFrame(JSON.parse(line));
      } catch {
        continue; // skip malformed line
      }
      const result = this.consumeFrame(frame, modelId, toolUseSeen);
      toolUseSeen = result.toolUseSeen;
      for (const chunk of result.chunks) yield chunk;
      if (result.terminal) return;
    }
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
    } else {
      // Server closed the stream without sending a final done frame.
      // Treat as an error so consumers don't hang in a streaming state.
      yield { type: 'done', finishReason: 'error', error: 'Ollama stream ended without done frame' };
    }
  }

  private nextToolCallId(index: number): string {
    const seq = this.toolCallSeq++;
    return `ollama-tool-${seq}-${index}`;
  }

  private consumeFrame(
    frame: OllamaStreamFrame,
    modelId: string,
    toolUseSeen: boolean,
  ): { chunks: LlmChunk[]; terminal: boolean; toolUseSeen: boolean } {
    const chunks: LlmChunk[] = [];
    if (frame.error) {
      chunks.push({ type: 'done', finishReason: 'error', error: frame.error });
      return { chunks, terminal: true, toolUseSeen };
    }

    if (frame.message?.content) chunks.push({ type: 'text', delta: frame.message.content });
    const toolCalls = frame.message?.tool_calls ?? [];
    for (let i = 0; i < toolCalls.length; i++) {
      const call = this.toToolCall(toolCalls[i], i);
      if (!call) continue;
      chunks.push({ type: 'tool_call', call });
      toolUseSeen = true;
    }

    if (!frame.done) return { chunks, terminal: false, toolUseSeen };
    const usage = parseOllamaUsage(frame, modelId);
    if (usage) chunks.push({ type: 'usage', usage });
    chunks.push({ type: 'done', finishReason: finishReasonForDone(frame.done_reason, toolUseSeen) });
    return { chunks, terminal: true, toolUseSeen };
  }

  private toToolCall(value: unknown, index: number): ToolCall | null {
    if (!isRecord(value)) return null;
    const fn = isRecord(value.function) ? value.function : undefined;
    return {
      id: typeof value.id === 'string' ? value.id : this.nextToolCallId(index),
      name: typeof fn?.name === 'string' ? fn.name : 'unknown',
      ...normalizeToolCallArguments(fn?.arguments, 'Ollama returned tool arguments that were not a JSON object.'),
    };
  }
}

function parseOllamaStreamFrame(value: unknown): OllamaStreamFrame {
  if (!isRecord(value)) return {};
  return {
    message: parseOllamaMessage(value.message),
    done: typeof value.done === 'boolean' ? value.done : undefined,
    done_reason: typeof value.done_reason === 'string' ? value.done_reason : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    prompt_eval_count: finiteNumber(value.prompt_eval_count, 0),
    eval_count: finiteNumber(value.eval_count, 0),
  };
}

function parseOllamaMessage(value: unknown): OllamaStreamFrame['message'] {
  if (!isRecord(value)) return undefined;
  return {
    role: typeof value.role === 'string' ? value.role : undefined,
    content: typeof value.content === 'string' ? value.content : undefined,
    tool_calls: Array.isArray(value.tool_calls) ? value.tool_calls : undefined,
  };
}

function parseOllamaUsage(frame: OllamaStreamFrame, modelId: string): LlmUsage | null {
  if (frame.prompt_eval_count == null && frame.eval_count == null) return null;
  const promptTokens = frame.prompt_eval_count;
  const completionTokens = frame.eval_count;
  return {
    providerId: 'ollama',
    modelId,
    ...(promptTokens != null ? { promptTokens } : {}),
    ...(completionTokens != null ? { completionTokens } : {}),
    totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
    costUsd: 0,
    costSource: 'local',
  };
}

function finishReasonForDone(doneReason: string | undefined, toolUseSeen: boolean): StreamFinishReason {
  return toolUseSeen ? 'tool_use' : normalizeFinishReason(doneReason) ?? 'stop';
}

function toOllamaTool(t: ToolDef): OllamaTool {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

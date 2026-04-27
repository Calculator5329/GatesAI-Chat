import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolDef } from '../../core/llm';
import { ensureOk } from './sse';

export interface OllamaProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

interface OllamaWireMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
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
 *
 * Task 3 ships the request side only; `parseNdjson` is a stub that yields an
 * explicit error so accidental routing through this provider before Task 4
 * lands fails loudly rather than silently truncating responses.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  ready(): boolean {
    return Boolean(this.baseUrl);
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body = {
      model: req.modelId,
      messages: this.buildMessages(req.messages, req.systemPrompt),
      stream: true,
      keep_alive: '5m',
      ...(req.tools && req.tools.length ? { tools: req.tools.map(toOllamaTool) } : {}),
      ...(typeof req.temperature === 'number' ? { options: { temperature: req.temperature } } : {}),
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
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    try { await ensureOk(response, 'Ollama'); }
    catch (err) { yield { type: 'done', finishReason: 'error', error: (err as Error).message }; return; }

    if (!response.body) {
      yield { type: 'done', finishReason: 'error', error: 'Ollama: empty response body' };
      return;
    }

    yield* this.parseNdjson(response.body, signal);
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
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      out.push(wire);
    }
    return out;
  }

  // Stub — replaced in Task 4 with real NDJSON parsing.
  private async *parseNdjson(_body: ReadableStream<Uint8Array>, _signal: AbortSignal): AsyncIterable<LlmChunk> {
    yield { type: 'done', finishReason: 'error', error: 'OllamaProvider: streaming parser not implemented yet (Task 4)' };
  }
}

function toOllamaTool(t: ToolDef): OllamaTool {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

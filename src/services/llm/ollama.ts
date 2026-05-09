import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolDef } from '../../core/llm';
import { ensureOk } from './sse';

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
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaStreamFrame {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      function?: { name?: string; arguments?: Record<string, unknown> };
    }>;
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
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

    const useTools = this.toolsEnabled && req.tools && req.tools.length > 0;
    const body = {
      model: req.modelId,
      messages: this.buildMessages(req.messages, req.systemPrompt),
      stream: true,
      keep_alive: '5m',
      ...(useTools ? { tools: req.tools!.map(toOllamaTool) } : {}),
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

  private async *parseNdjson(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolUseSeen = false;

    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let frame: OllamaStreamFrame;
          try {
            frame = JSON.parse(line);
          } catch {
            continue; // skip malformed line
          }

          if (frame.error) {
            yield { type: 'done', finishReason: 'error', error: frame.error };
            return;
          }

          const message = frame.message;
          if (message?.content) {
            yield { type: 'text', delta: message.content };
          }

          if (message?.tool_calls && message.tool_calls.length) {
            for (let i = 0; i < message.tool_calls.length; i++) {
              const tc = message.tool_calls[i];
              const args = tc.function?.arguments && typeof tc.function.arguments === 'object'
                ? tc.function.arguments
                : {};
              yield {
                type: 'tool_call',
                call: {
                  id: `ollama-tool-${i}`,
                  name: tc.function?.name ?? 'unknown',
                  arguments: args as Record<string, unknown>,
                },
              };
            }
            toolUseSeen = true;
          }

          if (frame.done) {
            yield { type: 'done', finishReason: toolUseSeen ? 'tool_use' : 'stop' };
            return;
          }
        }
      }
      // Flush the decoder and try to parse any trailing complete frame.
      buffer += decoder.decode();
      const trailing = buffer.trim();
      if (trailing) {
        try {
          const frame = JSON.parse(trailing) as OllamaStreamFrame;
          if (frame.error) {
            yield { type: 'done', finishReason: 'error', error: frame.error };
            return;
          }
          if (frame.message?.content) {
            yield { type: 'text', delta: frame.message.content };
          }
          if (frame.done) {
            yield { type: 'done', finishReason: toolUseSeen ? 'tool_use' : 'stop' };
            return;
          }
        } catch {
          // Ignore — falls through to the missing-done error path below.
        }
      }
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
      } else {
        // Server closed the stream without sending a final done frame.
        // Treat as an error so consumers don't hang in a streaming state.
        yield { type: 'done', finishReason: 'error', error: 'Ollama stream ended without done frame' };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function toOllamaTool(t: ToolDef): OllamaTool {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

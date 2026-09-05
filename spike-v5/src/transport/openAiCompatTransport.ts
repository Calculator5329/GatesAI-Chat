// Transport adapter: an OpenAI-compatible `/chat/completions` endpoint,
// which is how OpenRouter is reached today.
//
// It depends on the domain's `ChatTransport` port and on nothing else in the
// domain. `fetch` is injected rather than reached for, which is what makes
// the round-trip test below a real test of this file instead of a mock of it.

import type { ChatTransport, CompletionChunk, CompletionRequest } from '../domain/ports';
import { readSseData } from './sse';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatTransportOptions {
  readonly id?: string;
  readonly baseUrl: string;
  /** Read lazily so a rotated key is picked up without rebuilding the transport. */
  readonly apiKey: () => string | undefined;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
}

export class OpenAiCompatTransport implements ChatTransport {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: () => string | undefined;
  private readonly extraHeaders: Readonly<Record<string, string>>;
  private readonly doFetch: FetchLike;

  constructor(options: OpenAiCompatTransportOptions) {
    this.id = options.id ?? 'openai-compat';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.extraHeaders = options.extraHeaders ?? {};
    this.doFetch = options.fetch;
  }

  async *stream(request: CompletionRequest, signal: AbortSignal): AsyncIterable<CompletionChunk> {
    const key = this.apiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    };

    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
        }),
      });
    } catch (cause) {
      yield signal.aborted
        ? { type: 'done', finishReason: 'cancelled' }
        : { type: 'error', message: describe(cause) };
      return;
    }

    if (!response.ok) {
      yield { type: 'error', message: await httpErrorMessage(response, this.id) };
      return;
    }
    if (!response.body) {
      yield { type: 'error', message: `${this.id} returned no response body.` };
      return;
    }

    let finishReason: 'stop' | 'length' | undefined;
    for await (const payload of readSseData(response.body, signal)) {
      if (payload === '[DONE]') break;
      const frame = parseFrame(payload);
      if (!frame) continue;
      if (frame.delta) yield { type: 'text', delta: frame.delta };
      if (frame.usage) yield { type: 'usage', usage: frame.usage };
      if (frame.finishReason) finishReason = frame.finishReason;
    }

    yield signal.aborted
      ? { type: 'done', finishReason: 'cancelled' }
      : { type: 'done', finishReason: finishReason ?? 'stop' };
  }
}

interface ParsedFrame {
  delta?: string;
  finishReason?: 'stop' | 'length';
  usage?: { promptTokens: number; completionTokens: number };
}

function parseFrame(payload: string): ParsedFrame | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    // A malformed frame is a provider bug, not a reason to end a good stream.
    return undefined;
  }
  if (!isRecord(raw)) return undefined;

  const frame: ParsedFrame = {};
  const choices = raw.choices;
  if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
    const choice = choices[0];
    const delta = isRecord(choice.delta) ? choice.delta.content : undefined;
    if (typeof delta === 'string' && delta.length > 0) frame.delta = delta;
    const reason = choice.finish_reason;
    if (reason === 'stop') frame.finishReason = 'stop';
    if (reason === 'length' || reason === 'max_tokens') frame.finishReason = 'length';
  }

  if (isRecord(raw.usage)) {
    const prompt = raw.usage.prompt_tokens;
    const completion = raw.usage.completion_tokens;
    if (typeof prompt === 'number' || typeof completion === 'number') {
      frame.usage = {
        promptTokens: typeof prompt === 'number' ? prompt : 0,
        completionTokens: typeof completion === 'number' ? completion : 0,
      };
    }
  }

  return frame;
}

async function httpErrorMessage(response: Response, id: string): Promise<string> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '';
  }
  return `${id} ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

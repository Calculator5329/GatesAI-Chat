import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatProvider } from '../../../src/services/llm/openaiCompat';
import { AnthropicProvider } from '../../../src/services/llm/anthropic';
import { GeminiProvider } from '../../../src/services/llm/gemini';
import type { LlmRequest } from '../../../src/core/llm';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _c of stream) {
    // no-op
  }
}

function okSseOpenAi(): Response {
  return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function okSseAnthropic(): Response {
  return new Response(
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function okSseGemini(): Response {
  return new Response(
    'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

const visionRequest: LlmRequest = {
  modelId: 'test-model',
  messages: [
    {
      role: 'user',
      content: 'What is in this picture?',
      images: [{ mime: 'image/png', base64: 'AAA=' }],
    },
  ],
  tools: [],
};

describe('OpenAI-compat vision wire format', () => {
  it('emits content parts with text + image_url data URLs', async () => {
    let body: { messages: Array<{ role: string; content: unknown }> } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return okSseOpenAi();
      }),
    );

    const provider = new OpenAiCompatProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
    });
    await drain(provider.stream(visionRequest, new AbortController().signal));

    const user = body!.messages.find(m => m.role === 'user')!;
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toEqual({ type: 'text', text: 'What is in this picture?' });
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url?.url).toBe('data:image/png;base64,AAA=');
  });

  it('falls back to plain string content when there are no images', async () => {
    let body: { messages: Array<{ role: string; content: unknown }> } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return okSseOpenAi();
      }),
    );

    const provider = new OpenAiCompatProvider({ id: 'openai', name: 'OpenAI', baseUrl: 'https://example.test/v1', apiKey: 'k' });
    await drain(provider.stream({ ...visionRequest, messages: [{ role: 'user', content: 'plain' }] }, new AbortController().signal));

    const user = body!.messages.find(m => m.role === 'user')!;
    expect(user.content).toBe('plain');
  });
});

describe('Anthropic vision wire format', () => {
  it('emits image blocks with base64 source before the text block', async () => {
    let body: { messages: Array<{ role: string; content: unknown }> } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return okSseAnthropic();
      }),
    );

    const provider = new AnthropicProvider('k');
    await drain(provider.stream(visionRequest, new AbortController().signal));

    const user = body!.messages.find(m => m.role === 'user')!;
    const blocks = user.content as Array<{
      type: string;
      text?: string;
      source?: { type: string; media_type: string; data: string };
    }>;
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA=' },
    });
    expect(blocks[1]).toEqual({ type: 'text', text: 'What is in this picture?' });
  });
});

describe('Gemini vision wire format', () => {
  it('emits inlineData parts alongside the text part', async () => {
    let body: { contents: Array<{ role: string; parts: unknown[] }> } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return okSseGemini();
      }),
    );

    const provider = new GeminiProvider('k');
    await drain(provider.stream(visionRequest, new AbortController().signal));

    const user = body!.contents.find(c => c.role === 'user')!;
    const parts = user.parts as Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
    expect(parts[0]).toEqual({ text: 'What is in this picture?' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAA=' } });
  });
});

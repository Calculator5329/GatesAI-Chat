import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatProvider } from '../../../src/services/llm/openaiCompat';
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
      id: 'openrouter',
      name: 'OpenRouter',
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

    const provider = new OpenAiCompatProvider({ id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://example.test/v1', apiKey: 'k' });
    await drain(provider.stream({ ...visionRequest, messages: [{ role: 'user', content: 'plain' }] }, new AbortController().signal));

    const user = body!.messages.find(m => m.role === 'user')!;
    expect(user.content).toBe('plain');
  });
});

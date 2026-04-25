import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/services/llm/openrouter';
import type { LlmRequest } from '../../src/core/llm';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // Drain the provider stream so the request is issued.
  }
}

function okSseResponse(): Response {
  return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenRouterProvider', () => {
  it('sends Anthropic-routed tool results as a user turn, not a trailing tool message', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    const request: LlmRequest = {
      modelId: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_fs', name: 'fs', arguments: { action: 'read', path: 'notes/a.md' } }],
        },
        { role: 'tool', toolCallId: 'call_fs', toolName: 'fs', content: 'file contents' },
      ],
      tools: [],
    };

    await drain(provider.stream(request, new AbortController().signal));

    const messages = (body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages.at(-1)?.role).toBe('user');
    expect(JSON.stringify(messages.at(-1)?.content)).toContain('file contents');
    expect(messages.some(m => m.role === 'tool')).toBe(false);
  });

  it('keeps tool messages unchanged for non-Anthropic OpenRouter models', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    const request: LlmRequest = {
      modelId: 'openai/gpt-5.5',
      messages: [
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_fs', name: 'fs', arguments: { action: 'read', path: 'notes/a.md' } }],
        },
        { role: 'tool', toolCallId: 'call_fs', toolName: 'fs', content: 'file contents' },
      ],
      tools: [],
    };

    await drain(provider.stream(request, new AbortController().signal));

    const messages = (body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages.at(-1)?.role).toBe('tool');
    expect(messages.some(m => m.role === 'tool')).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/services/llm/openrouter';
import type { LlmChunk, LlmRequest } from '../../src/core/llm';

async function drain(stream: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const chunks: LlmChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
    // Drain the provider stream so the request is issued.
  }
  return chunks;
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

  it('emits provider usage and cost from OpenRouter stream chunks', async () => {
    const fetchMock = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: {"model":"openai/gpt-5.5","usage":{"prompt_tokens":100,"completion_tokens":25,"total_tokens":125,"cost":0.0123},"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    const chunks = await drain(provider.stream({
      modelId: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
    }, new AbortController().signal));

    expect(chunks).toContainEqual({
      type: 'usage',
      usage: {
        providerId: 'openrouter',
        modelId: 'openai/gpt-5.5',
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        costUsd: 0.0123,
      },
    });
  });

  it('does not send strict=true for action-based schemas with optional properties', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    await drain(provider.stream({
      modelId: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'Read a file.' }],
      tools: [
        {
          name: 'fs',
          description: 'filesystem',
          strict: true,
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['read', 'list'] },
              path: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
          },
        },
      ],
    }, new AbortController().signal));

    const tools = (body as { tools: Array<{ function: { strict?: boolean } }> }).tools;
    expect(tools[0].function.strict).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/services/llm/openrouter';
import { OpenAiCompatProvider } from '../../src/services/llm/openaiCompat';
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

  it('normalizes tool results for Anthropic latest aliases', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    await drain(provider.stream({
      modelId: '~anthropic/claude-sonnet-latest',
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
    }, new AbortController().signal));

    const messages = (body as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(messages.at(-1)?.role).toBe('user');
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

  it('asks OpenRouter to include usage in streamed responses', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    await drain(provider.stream({
      modelId: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
    }, new AbortController().signal));

    expect((body as { usage?: unknown }).usage).toEqual({ include: true });
  });

  it('attaches a named JSON schema response format', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    }));

    const schema = {
      type: 'object' as const,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    };
    await drain(new OpenRouterProvider('sk-or-test').stream({
      modelId: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'answer as JSON' }],
      responseFormat: { type: 'json_schema', name: 'answer', schema, strict: true },
    }, new AbortController().signal));

    expect((body as { response_format?: unknown }).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'answer', schema, strict: true },
    });
  });

  it('maps provider token-limit finish reasons to length', async () => {
    const fetchMock = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"max_tokens"}]}',
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

    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'length' });
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

  it('sends thinking effort through the OpenRouter reasoning parameter', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider('sk-or-test');
    await drain(provider.stream({
      modelId: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      thinkingEffort: 'high',
    }, new AbortController().signal));

    expect((body as { reasoning?: unknown }).reasoning).toEqual({ effort: 'high', exclude: true });
  });
});

describe('OpenAiCompatProvider custom endpoint', () => {
  it('keeps the complete composed system prompt as the first OpenAI message', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    }));
    const composed = 'Safety/tool scaffold.\n\nUser-configured instructions:\nBe concise.';
    const provider = new OpenAiCompatProvider({
      id: 'openrouter',
      name: 'Custom',
      baseUrl: 'http://localhost:1234/v1',
      requiresApiKey: false,
    });

    await drain(provider.stream({
      modelId: 'local-model',
      systemPrompt: composed,
      messages: [{ role: 'user', content: 'hi' }],
    }, new AbortController().signal));

    expect((body as { messages: unknown[] }).messages).toEqual([
      { role: 'system', content: composed },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('streams through the normalized custom URL with optional authorization', async () => {
    let body: unknown;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okSseResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatProvider({
      id: 'openrouter',
      name: 'Custom',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'sk-local',
      requiresApiKey: false,
      available: true,
    });

    await drain(provider.stream({
      modelId: 'qwen/qwen3',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        name: 'fs',
        description: 'filesystem',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      }],
    }, new AbortController().signal));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-local',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(body).toEqual(expect.objectContaining({
      model: 'qwen/qwen3',
      stream: true,
      tool_choice: 'auto',
    }));
  });
});

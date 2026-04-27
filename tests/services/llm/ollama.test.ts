import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../../src/services/llm/ollama';

function captureRequest(): { fetchMock: ReturnType<typeof vi.fn>; getBody: () => any } {
  let lastBody: any = null;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    lastBody = init.body ? JSON.parse(init.body as string) : null;
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: emptyStream(),
    } as unknown as Response;
  });
  return { fetchMock, getBody: () => lastBody };
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.close(); } });
}

describe('OllamaProvider — request shape', () => {
  it('POSTs to <baseUrl>/api/chat with stream:true', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });

    const iter = provider.stream(
      { modelId: 'llama3.1:8b', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* drain */ }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = getBody();
    expect(body.model).toBe('llama3.1:8b');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    vi.unstubAllGlobals();
  });

  it('passes Authorization header only when apiKey is set', async () => {
    const { fetchMock } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);

    const noKey = new OllamaProvider({ baseUrl: 'http://h:1' });
    for await (const _ of noKey.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) { /* */ }
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');

    fetchMock.mockClear();
    const withKey = new OllamaProvider({ baseUrl: 'http://h:1', apiKey: 'k' });
    for await (const _ of withKey.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) { /* */ }
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    vi.unstubAllGlobals();
  });

  it('rewrites user images into the messages[].images base64 array', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://h:1' });

    const iter = provider.stream(
      { modelId: 'llava', messages: [{
        role: 'user',
        content: 'what is this',
        images: [{ mime: 'image/png', base64: 'ABCD' }],
      }] },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* */ }

    const body = getBody();
    expect(body.messages[0].images).toEqual(['ABCD']);
    expect(body.messages[0].content).toBe('what is this');
    vi.unstubAllGlobals();
  });

  it('forwards tools when provided', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://h:1' });

    const tools = [{
      name: 'get_time',
      description: 'Returns the current time',
      parameters: { type: 'object' as const, properties: {}, required: [] },
    }];
    const iter = provider.stream(
      { modelId: 'qwen2.5', messages: [{ role: 'user', content: 'x' }], tools },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* */ }

    const body = getBody();
    expect(body.tools).toEqual([{
      type: 'function',
      function: { name: 'get_time', description: 'Returns the current time', parameters: { type: 'object', properties: {}, required: [] } },
    }]);
    vi.unstubAllGlobals();
  });
});

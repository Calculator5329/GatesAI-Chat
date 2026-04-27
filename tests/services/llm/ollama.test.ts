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

  it('drops tools from the request when toolsEnabled is false', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://h:1', toolsEnabled: false });

    const tools = [{ name: 't', description: 'd', parameters: { type: 'object' as const, properties: {}, required: [] } }];
    for await (const _ of provider.stream({ modelId: 'm', messages: [], tools }, new AbortController().signal)) { /* */ }

    const body = getBody();
    expect(body).not.toHaveProperty('tools');
    vi.unstubAllGlobals();
  });
});

function ndjsonResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const line of lines) c.enqueue(enc.encode(line + '\n'));
        c.close();
      },
    }),
  } as unknown as Response;
}

describe('OllamaProvider — streaming response', () => {
  it('emits text chunks as message.content arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: ' world' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks).toEqual([
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ' world' },
      { type: 'done', finishReason: 'stop' },
    ]);
    vi.unstubAllGlobals();
  });

  it('emits tool_call chunks with synthesized ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'get_time', arguments: {} } },
        { function: { name: 'note', arguments: { text: 'hi' } } },
      ] }, done: false }),
      JSON.stringify({ done: true, done_reason: 'stop' }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks).toContainEqual({ type: 'tool_call', call: { id: 'ollama-tool-0', name: 'get_time', arguments: {} } });
    expect(chunks).toContainEqual({ type: 'tool_call', call: { id: 'ollama-tool-1', name: 'note', arguments: { text: 'hi' } } });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done', finishReason: 'tool_use' });
    vi.unstubAllGlobals();
  });

  it('surfaces Ollama JSON error frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ error: "model 'foo' not found, try pulling it first" }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'foo', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks[chunks.length - 1]).toEqual({
      type: 'done',
      finishReason: 'error',
      error: "model 'foo' not found, try pulling it first",
    });
    vi.unstubAllGlobals();
  });

  it('yields cancelled when the signal aborts mid-stream', async () => {
    const enc = new TextEncoder();
    let enqueueSecond: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: 'Hi' }, done: false }) + '\n'));
        // Delay the second frame so the test can abort between them.
        enqueueSecond = () => {
          c.enqueue(enc.encode(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n'));
          c.close();
        };
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: stream,
    } as unknown as Response)));

    const controller = new AbortController();
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks: Array<{ type: string; finishReason?: string; delta?: string }> = [];

    const iter = p.stream({ modelId: 'm', messages: [] }, controller.signal);
    for await (const c of iter) {
      chunks.push(c as { type: string; finishReason?: string; delta?: string });
      if ((c as { type: string }).type === 'text') {
        controller.abort();
        // Drain the deferred enqueue so the stream isn't left hanging on close.
        (enqueueSecond as (() => void) | null)?.();
      }
    }

    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hi' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done', finishReason: 'cancelled' });
    vi.unstubAllGlobals();
  });

  it('yields error done when the stream closes without a done frame', async () => {
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: 'partial' }, done: false }) + '\n'));
          c.close();
        },
      }),
    } as unknown as Response)));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'partial' });
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'done', finishReason: 'error' });
    expect((chunks[chunks.length - 1] as { error: string }).error).toMatch(/without done frame/);
    vi.unstubAllGlobals();
  });

  it('handles split lines across reads', async () => {
    const enc = new TextEncoder();
    const part1 = JSON.stringify({ message: { role: 'assistant', content: 'Hel' }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: false }).slice(0, 10);
    const part2 = JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: false }).slice(10) + '\n' + JSON.stringify({ done: true, done_reason: 'stop' }) + '\n';

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(part1));
          c.enqueue(enc.encode(part2));
          c.close();
        },
      }),
    } as unknown as Response)));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    const text = chunks.filter(c => c.type === 'text').map(c => c.delta).join('');
    expect(text).toBe('Hello');
    vi.unstubAllGlobals();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pullModel, deleteModel, type OllamaPullProgress } from '../../../src/services/llm/ollamaPull';

function ndjsonResponse(frames: unknown[]): Response {
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(enc.encode(`${JSON.stringify(frame)}\n`));
        controller.close();
      },
    }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ollamaPull', () => {
  it('posts to /api/pull with stream true and auth header', async () => {
    const fetchMock = vi.fn(async () => ndjsonResponse([{ status: 'success' }]));
    vi.stubGlobal('fetch', fetchMock);

    await pullModel('llama3.2:3b', {
      baseUrl: 'http://host:11434/',
      apiKey: 'key',
    }, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith('http://host:11434/api/pull', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'llama3.2:3b', stream: true }),
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    }));
  });

  it('reports monotonic progress for multi-layer out-of-order frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      { status: 'pulling manifest' },
      { status: 'pulling layer a', digest: 'a', total: 100, completed: 50 },
      { status: 'pulling layer b', digest: 'b', total: 300, completed: 30 },
      { status: 'pulling layer a', digest: 'a', total: 100, completed: 40 },
      { status: 'pulling layer b', digest: 'b', total: 300, completed: 300 },
      { status: 'success' },
    ])));
    const updates: OllamaPullProgress[] = [];

    await pullModel('qwen2.5:7b', {
      baseUrl: 'http://host',
      onProgress: progress => updates.push(progress),
    }, new AbortController().signal);

    expect(updates.at(-1)).toEqual({ phase: 'success', percent: 100 });
    const percents = updates.map(update => update.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents).toContain(50);
  });

  it('parses NDJSON progress split across transport chunks and ignores malformed frames', async () => {
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('{"status":"pulling layer","digest":"a","total":100,'));
          controller.enqueue(enc.encode('"completed":25}\nnot-json\n{"status":"success"}\n'));
          controller.close();
        },
      }),
    } as unknown as Response)));
    const updates: OllamaPullProgress[] = [];

    await pullModel('qwen2.5:7b', {
      baseUrl: 'http://host',
      onProgress: progress => updates.push(progress),
    }, new AbortController().signal);

    expect(updates).toContainEqual({ phase: 'pulling layer', percent: 25 });
    expect(updates.at(-1)).toEqual({ phase: 'success', percent: 100 });
  });

  it('throws an error frame mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      { status: 'pulling manifest' },
      { error: 'not found' },
      { status: 'success' },
    ])));

    await expect(pullModel('missing', { baseUrl: 'http://host' }, new AbortController().signal))
      .rejects.toThrow('not found');
  });

  it('supports abort while reading progress', async () => {
    const enc = new TextEncoder();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(enc.encode(`${JSON.stringify({ status: 'pulling layer', digest: 'a', total: 100, completed: 10 })}\n`));
          controller.abort();
          stream.enqueue(enc.encode(`${JSON.stringify({ status: 'success' })}\n`));
          stream.close();
        },
      }),
    } as unknown as Response)));

    await expect(pullModel('llama3.2:3b', { baseUrl: 'http://host' }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('deletes a model through /api/delete', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, headers: new Headers(), text: async () => '' }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await deleteModel('llama3.2:3b', { baseUrl: 'http://host/' });

    expect(fetchMock).toHaveBeenCalledWith('http://host/api/delete', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ model: 'llama3.2:3b' }),
    }));
  });
});

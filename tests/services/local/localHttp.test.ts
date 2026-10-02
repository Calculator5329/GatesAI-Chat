import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Emit = (message: unknown) => void;
interface SentRequest { id: string; url: string; method: string; headers: Record<string, string>; body: string | null }

const tauri = vi.hoisted(() => ({
  isTauri: true,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauri.invoke,
  Channel: class { onmessage: (message: unknown) => void = () => {}; },
}));
vi.mock('../../../src/core/runtime', () => ({ isTauri: () => tauri.isTauri }));

import { localFetch } from '../../../src/services/local/localHttp';

const enc = new TextEncoder();
const chunk = (text: string): ArrayBuffer => enc.encode(text).buffer as ArrayBuffer;
const head = (status: number, statusText: string, contentType: string | null) => ({ event: 'head', status, statusText, contentType });

/** Stands in for the Rust command: records the request and hands the test its channel. */
function fakeRust(): { sent: Promise<{ request: SentRequest; emit: Emit }> } {
  let deliver!: (value: { request: SentRequest; emit: Emit }) => void;
  const sent = new Promise<{ request: SentRequest; emit: Emit }>(resolve => { deliver = resolve; });
  tauri.invoke.mockImplementation(async (cmd: string, args: { request: SentRequest; onEvent: { onmessage: Emit } }) => {
    if (cmd === 'local_http_request') deliver({ request: args.request, emit: message => args.onEvent.onmessage(message) });
  });
  return { sent };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  tauri.isTauri = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localFetch on desktop', () => {
  it('forwards the request and resolves at head while chunks keep streaming in order', async () => {
    const rust = fakeRust();
    const pending = localFetch('http://192.168.1.20:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: '{"model":"m"}',
    });
    const { request, emit } = await rust.sent;
    expect(request).toMatchObject({
      url: 'http://192.168.1.20:11434/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: '{"model":"m"}',
    });

    emit(head(200, 'OK', 'application/x-ndjson'));
    emit(chunk('{"n":1}\n'));
    const response = await pending;
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('{"n":1}\n');
    emit(chunk('{"n":2}\n{"n"'));
    emit(chunk(':3}\n'));
    emit({ event: 'end' });
    let rest = '';
    for (let next = await reader.read(); !next.done; next = await reader.read()) rest += decoder.decode(next.value);
    expect(rest).toBe('{"n":2}\n{"n":3}\n');
  });

  it('surfaces an HTTP error status as ok false with a readable body', async () => {
    const rust = fakeRust();
    const pending = localFetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: '{}' });
    const { emit } = await rust.sent;
    emit(head(404, 'Not Found', 'application/json'));
    emit(chunk('{"error":"model not found"}'));
    emit({ event: 'end' });

    const response = await pending;
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(response.statusText).toBe('Not Found');
    expect(await response.json()).toEqual({ error: 'model not found' });
  });

  it('round-trips a binary body byte for byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28]);
    const rust = fakeRust();
    const pending = localFetch('http://127.0.0.1:8188/view?filename=a.png&type=output');
    const { emit } = await rust.sent;
    emit(head(200, 'OK', 'image/png'));
    emit(png.slice(0, 9).buffer);
    emit(png.slice(9).buffer);
    emit({ event: 'end' });

    const response = await pending;
    expect((await response.clone().blob()).type).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it('rejects with AbortError and cancels the Rust request when aborted before the head', async () => {
    const rust = fakeRust();
    const controller = new AbortController();
    const pending = localFetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal: controller.signal });
    const { request } = await rust.sent;

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(tauri.invoke).toHaveBeenCalledWith('local_http_cancel', { id: request.id });
  });

  it('errors the body with AbortError and cancels when aborted mid-stream', async () => {
    const rust = fakeRust();
    const controller = new AbortController();
    const pending = localFetch('http://127.0.0.1:11434/api/pull', { method: 'POST', signal: controller.signal });
    const { request, emit } = await rust.sent;
    emit(head(200, 'OK', 'application/x-ndjson'));
    emit(chunk('{"status":"pulling"}\n'));
    const reader = (await pending).body!.getReader();
    await reader.read();

    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(tauri.invoke).toHaveBeenCalledWith('local_http_cancel', { id: request.id });
  });

  it('cancels the Rust request when the reader cancels the body, then ignores late events', async () => {
    const rust = fakeRust();
    const pending = localFetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: '{}' });
    const { request, emit } = await rust.sent;
    emit(head(200, 'OK', 'application/x-ndjson'));
    const reader = (await pending).body!.getReader();

    await reader.cancel();
    await flush();
    expect(tauri.invoke).toHaveBeenCalledWith('local_http_cancel', { id: request.id });
    expect(() => emit(chunk('{"status":"late"}\n'))).not.toThrow();
    expect(() => emit({ event: 'end' })).not.toThrow();
  });

  it('rejects with AbortError and never starts the request when the signal is already aborted', async () => {
    fakeRust();
    const controller = new AbortController();
    controller.abort();

    const pending = localFetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal: controller.signal });
    expect(tauri.invoke).not.toHaveBeenCalled();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not cancel a request that already ended when its signal aborts later', async () => {
    const rust = fakeRust();
    const controller = new AbortController();
    const pending = localFetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    const { emit } = await rust.sent;
    emit(head(200, 'OK', 'application/json'));
    emit(chunk('{"models":[]}'));
    emit({ event: 'end' });
    expect(await (await pending).json()).toEqual({ models: [] });

    controller.abort();
    await flush();
    expect(tauri.invoke).not.toHaveBeenCalledWith('local_http_cancel', expect.anything());
  });

  it.each([
    [204, 'No Content'],
    [304, 'Not Modified'],
  ])('resolves a %i head with a null body instead of throwing', async (status, statusText) => {
    const rust = fakeRust();
    const pending = localFetch('http://127.0.0.1:8188/interrupt', { method: 'POST' });
    const { emit } = await rust.sent;
    emit(head(status, statusText, null));
    emit({ event: 'end' });

    const response = await pending;
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('rejects like fetch when the connection fails or the URL is refused', async () => {
    const rust = fakeRust();
    const pending = localFetch('http://10.0.0.9:11434/api/tags');
    const { emit } = await rust.sent;
    emit({ event: 'error', message: 'tcp connect error: Connection refused' });
    await expect(pending).rejects.toThrow(new TypeError('tcp connect error: Connection refused'));

    tauri.invoke.mockRejectedValueOnce('/admin is not an Ollama or ComfyUI API path GatesAI can call.');
    await expect(localFetch('http://10.0.0.9/admin')).rejects.toThrow(/not an Ollama or ComfyUI API path/);
  });
});

describe('localFetch in the browser', () => {
  it('delegates to window.fetch with the same arguments', async () => {
    tauri.isTauri = false;
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const init = { method: 'GET' as const, headers: { Accept: 'application/json' } };

    await localFetch('http://127.0.0.1:11434/api/tags', init);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', init);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});

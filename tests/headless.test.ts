// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootHeadlessCore, runHeadlessCli } from '../src/headless';

const encoder = new TextEncoder();

function ollamaFetch(): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/version')) return new Response('{}');
    if (url.endsWith('/api/tags')) {
      return Response.json({ models: [{ name: 'tiny:latest' }] });
    }
    if (url.endsWith('/api/chat') && init?.method === 'POST') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"hello "},"done":false}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"headless"},"done":false}\n'));
          controller.enqueue(encoder.encode('{"done":true,"done_reason":"stop"}\n'));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('headless core', () => {
  it('boots and disposes the full RootStore graph without browser globals', () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();

    const core = bootHeadlessCore();
    expect(core.store.runtime).toBe('headless');
    expect(core.store.chat).toBeDefined();
    expect(core.store.rag).toBeDefined();
    expect(core.store.bridge.isOnline).toBe(false);
    expect(() => core.dispose()).not.toThrow();
  });

  it('connects Ollama and streams a normal ChatStore turn', async () => {
    vi.stubGlobal('fetch', ollamaFetch());
    const core = bootHeadlessCore();
    core.store.ui.setAutoNamingEnabled(false);
    const deltas: string[] = [];

    const models = await core.connectOllama({ baseUrl: 'http://ollama.test:11434' });
    const reply = await core.sendMessage('Say hello', {
      model: 'tiny:latest',
      onText: delta => deltas.push(delta),
    });

    expect(models.map(model => model.id)).toEqual(['ollama-tiny:latest']);
    expect(reply.text).toBe('hello headless');
    expect(deltas.join('')).toBe(reply.text);
    expect(core.store.chat.activeThread?.messages).toHaveLength(2);
    core.dispose();
  });

  it('runs the scripted CLI and writes streamed output', async () => {
    vi.stubGlobal('fetch', ollamaFetch());
    let stdout = '';
    let stderr = '';

    const exitCode = await runHeadlessCli(
      ['--base-url', 'http://ollama.test:11434', '--model', 'tiny:latest', 'hello'],
      {
        stdout: { write: text => { stdout += text; } },
        stderr: { write: text => { stderr += text; } },
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe('hello headless\n');
    expect(stderr).toBe('');
  });
});

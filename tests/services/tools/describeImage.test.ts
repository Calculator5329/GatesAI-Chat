import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeImageTool } from '../../../src/services/tools/describeImage';
import type { ToolContext } from '../../../src/services/tools/types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('describe_image tool', () => {
  it('sends the selected local vision model and attachment bytes to Ollama', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, body: JSON.parse(init?.body as string) });
      return new Response(JSON.stringify({ message: { content: 'A red fox in snow.' } }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await describeImageTool.execute(
      { path: '/workspace/artifacts/fox.png', question: 'What is this?' },
      makeCtx(),
    );

    expect(out).toBe('A red fox in snow.');
    expect(calls[0].url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0].body).toMatchObject({
      model: 'qwen2.5-vl:7b',
      stream: false,
      messages: [{
        role: 'user',
        content: 'What is this?',
        images: ['abc123'],
      }],
    });
  });

  it('reports a clear error when no local vision model is selected', async () => {
    const out = await describeImageTool.execute(
      { path: '/workspace/artifacts/fox.png' },
      makeCtx({ visionModel: undefined }),
    );

    expect(out).toMatch(/No local vision model selected/i);
  });

  it('requires the bridge so workspace images can be read', async () => {
    const out = await describeImageTool.execute(
      { path: '/workspace/artifacts/fox.png' },
      makeCtx({ bridgeOnline: false }),
    );

    expect(out).toMatch(/bridge is offline/i);
  });
});

function makeCtx(opts: { visionModel?: string; bridgeOnline?: boolean } = {}): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    threadId: 't-test',
    bridge: {
      isOnline: opts.bridgeOnline ?? true,
      client: { request: vi.fn() },
      readAttachmentBase64: vi.fn(async () => ({ base64: 'abc123', mime: 'image/png', size: 10 })),
    },
    localRuntime: {
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      visionModel: Object.prototype.hasOwnProperty.call(opts, 'visionModel') ? opts.visionModel : 'qwen2.5-vl:7b',
    },
  } as unknown as ToolContext;
}

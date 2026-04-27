import { describe, expect, it, vi, afterEach } from 'vitest';
import { imageGenerateTool } from '../../../src/services/tools/imageGenerate';
import type { ToolContext } from '../../../src/services/tools/types';

interface FakeRequest { op: string; data: unknown }

function fakeBridge(opts: {
  online: boolean;
  requests?: FakeRequest[];
  respond?: (op: string, data: unknown) => unknown;
}): ToolContext['bridge'] {
  return {
    isOnline: opts.online,
    client: {
      request: async (op: string, data: unknown) => {
        opts.requests?.push({ op, data });
        return opts.respond ? opts.respond(op, data) : { path: (data as { path: string }).path, bytes: 1 };
      },
    },
    readAttachmentBase64: async () => null,
  } as unknown as ToolContext['bridge'];
}

function fakeImageGen(opts: {
  backend?: 'local-comfy' | 'local-a1111';
  comfyBaseUrl?: string;
  a1111BaseUrl?: string;
  comfyWorkflowPath?: string;
  comfyQualityPreset?: 'final' | 'draft';
  promptEnhancement?: 'off' | 'llm';
  promptStylePreset?: 'auto' | 'photorealistic' | 'concept-art' | 'abstract' | 'illustration';
} = {}): ToolContext['imageGen'] {
  const backend = opts.backend ?? 'local-comfy';
  return {
    backend,
    comfyWorkflowPath: opts.comfyWorkflowPath,
    getCredential: (b) => {
      const which = b ?? backend;
      if (which === 'local-comfy') return opts.comfyBaseUrl ?? null;
      if (which === 'local-a1111') return opts.a1111BaseUrl ?? null;
      return null;
    },
    toBackendConfig: () => ({
      primary: backend,
      comfyBaseUrl: opts.comfyBaseUrl,
      comfyQualityPreset: opts.comfyQualityPreset,
      promptEnhancement: opts.promptEnhancement,
      promptStylePreset: opts.promptStylePreset,
      a1111BaseUrl: opts.a1111BaseUrl,
    }),
  };
}

function makeCtx(overrides: Partial<ToolContext>): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    threadId: 't-test',
    ...overrides,
  } as unknown as ToolContext;
}

const originalFetch = globalThis.fetch;

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function text(out: Awaited<ReturnType<typeof imageGenerateTool.execute>>): string {
  return typeof out === 'string' ? out : out.content;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('image_generate tool', () => {
  it('rejects empty prompts', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ comfyBaseUrl: 'http://127.0.0.1:8188' }) });
    const out = await imageGenerateTool.execute({ prompt: '   ' }, ctx);
    expect(text(out)).toMatch(/`prompt` is required/);
  });

  it('reports a clear error when ComfyUI base URL is not configured', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({}) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(text(out)).toMatch(/ComfyUI base URL/i);
  });

  it('reports a clear error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }), imageGen: fakeImageGen({ comfyBaseUrl: 'http://127.0.0.1:8188' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(text(out)).toMatch(/bridge is offline/i);
  });

  it('rejects incomplete explicit pixel dimensions', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ comfyBaseUrl: 'http://127.0.0.1:8188' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1360 }, ctx);
    expect(text(out)).toMatch(/width and height/i);
  });

  it('rejects explicit pixel dimensions that are not multiples of 16', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ comfyBaseUrl: 'http://127.0.0.1:8188' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1361, height: 768 }, ctx);
    expect(text(out)).toMatch(/multiples of 16/i);
  });

  it('does not load a custom Comfy workflow while draft quality is selected', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: (op, data) => {
          if (op === 'fs.write') return { path: (data as { path: string }).path, bytes: 10 };
          throw new Error(`unexpected bridge request ${op}`);
        },
      }),
      imageGen: fakeImageGen({
        backend: 'local-comfy',
        comfyBaseUrl: 'http://127.0.0.1:8188',
        comfyWorkflowPath: 'notes/flux2-workflow.json',
        comfyQualityPreset: 'draft',
      }),
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200 });
      if (url.includes('/history/')) return new Response(JSON.stringify({ p: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200 });
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await imageGenerateTool.execute({ prompt: 'draft background' }, ctx);
    expect(text(out)).toMatch(/backend=local-comfy/);
    expect(requests.some((r) => r.op === 'fs.read')).toBe(false);
  });
});

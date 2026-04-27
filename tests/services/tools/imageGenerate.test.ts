import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

function fakeImageGen(opts: { key?: string; backend?: 'fal' | 'local-comfy' | 'local-a1111'; comfyBaseUrl?: string; a1111BaseUrl?: string; fallback?: 'fal' | null; comfyWorkflowPath?: string; comfyQualityPreset?: 'final' | 'draft'; defaultVariant?: 'flux-2-pro' | 'flux-2-flex' | 'flux-2-dev'; promptEnhancement?: 'off' | 'llm'; promptStylePreset?: 'auto' | 'photorealistic' | 'concept-art' | 'abstract' | 'illustration' }): ToolContext['imageGen'] {
  const backend = opts.backend ?? 'fal';
  return {
    backend,
    comfyWorkflowPath: opts.comfyWorkflowPath,
    getCredential: (b) => {
      const which = b ?? backend;
      if (which === 'fal') return opts.key ?? null;
      if (which === 'local-comfy') return opts.comfyBaseUrl ?? null;
      if (which === 'local-a1111') return opts.a1111BaseUrl ?? null;
      return null;
    },
    toBackendConfig: () => ({
      primary: backend,
      falApiKey: opts.key,
      comfyBaseUrl: opts.comfyBaseUrl,
      comfyQualityPreset: opts.comfyQualityPreset,
      promptEnhancement: opts.promptEnhancement,
      promptStylePreset: opts.promptStylePreset,
      a1111BaseUrl: opts.a1111BaseUrl,
      fallback: opts.fallback ?? null,
      defaultVariant: opts.defaultVariant,
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

// Stub the global fetch the FluxClient reaches for. Kept at module scope so
// each test can tune the responses; restored in afterEach.
const originalFetch = globalThis.fetch;

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function text(out: Awaited<ReturnType<typeof imageGenerateTool.execute>>): string {
  return typeof out === 'string' ? out : out.content;
}

beforeEach(() => {
  const impl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://fal.run/')) {
      return new Response(JSON.stringify({
        images: [{ url: 'https://cdn.fal/img.png', width: 1024, height: 1024 }],
        seed: 7,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://cdn.fal/img.png') {
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  globalThis.fetch = impl as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('image_generate tool', () => {
  it('rejects empty prompts', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ key: 'k' }) });
    const out = await imageGenerateTool.execute({ prompt: '   ' }, ctx);
    expect(text(out)).toMatch(/`prompt` is required/);
  });

  it('reports a clear error when no fal key is configured', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({}) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(text(out)).toMatch(/no fal\.ai API key/i);
  });

  it('reports a clear error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }), imageGen: fakeImageGen({ key: 'k' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(text(out)).toMatch(/bridge is offline/i);
  });

  it('writes base64 bytes to /workspace/artifacts/ via fs.write', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 12345 }),
      }),
      imageGen: fakeImageGen({ key: 'fal-key' }),
    });

    const out = await imageGenerateTool.execute(
      { prompt: 'a cathedral', aspect_ratio: '16:9', variant: 'flux-2-pro', filename: 'cathedral' },
      ctx,
    );

    expect(text(out)).toMatch(/Saved: \/workspace\/artifacts\/cathedral\.png/);
    expect(text(out)).toMatch(/backend=fal/);
    expect(text(out)).toMatch(/seed=7/);
    expect(typeof out === 'string' ? null : out.artifacts).toEqual([
      { kind: 'image', path: '/workspace/artifacts/cathedral.png', mime: 'image/png' },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0].op).toBe('fs.write');
    const data = requests[0].data as { path: string; encoding: string; content: string };
    expect(data.path).toBe('/workspace/artifacts/cathedral.png');
    expect(data.encoding).toBe('base64');
    expect(data.content.length).toBeGreaterThan(0);
  });

  it('enhances prompts when promptEnhancement is enabled', async () => {
    const requests: FakeRequest[] = [];
    const calls: Array<{ url: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.startsWith('https://fal.run/')) {
        return new Response(JSON.stringify({
          images: [{ url: 'https://cdn.fal/img.png', width: 1024, height: 1024 }],
          seed: 7,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://cdn.fal/img.png') {
        return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 12345 }),
      }),
      chat: {
        llmComplete: vi.fn(async () => 'cinematic neon city, blue and violet rim light, wide angle'),
      } as unknown as ToolContext['chat'],
      imageGen: fakeImageGen({
        key: 'fal-key',
        promptEnhancement: 'llm',
        promptStylePreset: 'concept-art',
      }),
    });

    const out = await imageGenerateTool.execute({ prompt: 'neon city', filename: 'enhanced' }, ctx);

    expect(text(out)).toContain('Enhanced prompt: cinematic neon city');
    const falCall = calls.find(c => c.url.startsWith('https://fal.run/'));
    expect((falCall?.body as { prompt?: string }).prompt).toContain('cinematic neon city');
  });

  it('rejects incomplete explicit pixel dimensions', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ key: 'k' }) });

    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1360 }, ctx);

    expect(text(out)).toMatch(/width and height/i);
  });

  it('rejects explicit pixel dimensions that are not multiples of 16', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({ key: 'k' }) });

    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1361, height: 768 }, ctx);

    expect(text(out)).toMatch(/multiples of 16/i);
  });

  it('defaults to a timestamped filename when none given', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 10 }),
      }),
      imageGen: fakeImageGen({ key: 'fal-key' }),
    });

    const out = await imageGenerateTool.execute({ prompt: 'a forest' }, ctx);
    expect(text(out)).toMatch(/\/workspace\/artifacts\/flux-\d{8}-\d{6}\.png/);
  });

  it('sanitizes filenames with path separators and unsafe characters', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 10 }),
      }),
      imageGen: fakeImageGen({ key: 'fal-key' }),
    });
    const out = await imageGenerateTool.execute(
      { prompt: 'x', filename: '../evil/name with spaces?' },
      ctx,
    );
    const pathMatch = text(out).match(/\/workspace\/artifacts\/[^\s]+\.png/);
    expect(pathMatch).not.toBeNull();
    const filename = pathMatch![0];
    expect(filename).not.toMatch(/\.\./);
    expect(filename).not.toMatch(/ /);
    expect(filename).toMatch(/evil_name_with_spaces/);
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

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200 });
      if (url.includes('/history/')) return new Response(JSON.stringify({ p: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200 });
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const out = await imageGenerateTool.execute({ prompt: 'draft background' }, ctx);
      expect(text(out)).toMatch(/backend=local-comfy/);
      expect(requests.some((r) => r.op === 'fs.read')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('honors snapshot.defaultVariant when args.variant is omitted', async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url.startsWith('https://fal.run/')) {
        return new Response(JSON.stringify({
          images: [{ url: 'https://cdn.fal/img.png', width: 1024, height: 1024 }],
          seed: 1,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://cdn.fal/img.png') {
        return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    globalThis.fetch = impl as unknown as typeof fetch;

    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 10 }),
      }),
      imageGen: fakeImageGen({ key: 'k', defaultVariant: 'flux-2-flex' }),
    });

    await imageGenerateTool.execute({ prompt: 'sunset' }, ctx);
    expect(calls.some(u => u.startsWith('https://fal.run/fal-ai/flux/v2/flex'))).toBe(true);
  });

  it('args.variant overrides snapshot.defaultVariant', async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url.startsWith('https://fal.run/')) {
        return new Response(JSON.stringify({ images: [{ url: 'https://cdn.fal/img.png', width: 1, height: 1 }], seed: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://cdn.fal/img.png') return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200, headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected fetch ${url}`);
    });
    globalThis.fetch = impl as unknown as typeof fetch;

    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 10 }),
      }),
      imageGen: fakeImageGen({ key: 'k', defaultVariant: 'flux-2-flex' }),
    });

    await imageGenerateTool.execute({ prompt: 'sunset', variant: 'flux-2-dev' }, ctx);
    expect(calls.some(u => u.startsWith('https://fal.run/fal-ai/flux/v2/dev'))).toBe(true);
    expect(calls.some(u => u.startsWith('https://fal.run/fal-ai/flux/v2/flex'))).toBe(false);
  });

  it('falls back to flux-2-pro when neither args.variant nor defaultVariant is set', async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url.startsWith('https://fal.run/')) {
        return new Response(JSON.stringify({ images: [{ url: 'https://cdn.fal/img.png', width: 1, height: 1 }], seed: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://cdn.fal/img.png') return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200, headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected fetch ${url}`);
    });
    globalThis.fetch = impl as unknown as typeof fetch;

    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (_op, data) => ({ path: (data as { path: string }).path, bytes: 10 }),
      }),
      imageGen: fakeImageGen({ key: 'k' }),
    });

    await imageGenerateTool.execute({ prompt: 'sunset' }, ctx);
    expect(calls.some(u => u.startsWith('https://fal.run/fal-ai/flux-pro/v2'))).toBe(true);
  });
});

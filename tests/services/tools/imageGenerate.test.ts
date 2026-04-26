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

function fakeImageGen(opts: { key?: string; backend?: 'fal' | 'local-comfy' | 'local-a1111'; comfyBaseUrl?: string; a1111BaseUrl?: string; fallback?: 'fal' | null; comfyWorkflowPath?: string }): ToolContext['imageGen'] {
  const backend = opts.backend ?? 'fal';
  return {
    hasUsableBackend: !!(opts.key ?? opts.comfyBaseUrl ?? opts.a1111BaseUrl),
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
      a1111BaseUrl: opts.a1111BaseUrl,
      fallback: opts.fallback ?? null,
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
      return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } });
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
    expect(out).toMatch(/`prompt` is required/);
  });

  it('reports a clear error when no fal key is configured', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }), imageGen: fakeImageGen({}) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(out).toMatch(/no fal\.ai API key/i);
  });

  it('reports a clear error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }), imageGen: fakeImageGen({ key: 'k' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(out).toMatch(/bridge is offline/i);
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

    expect(out).toMatch(/Saved: \/workspace\/artifacts\/cathedral\.png/);
    expect(out).toMatch(/backend=fal/);
    expect(out).toMatch(/seed=7/);

    expect(requests).toHaveLength(1);
    expect(requests[0].op).toBe('fs.write');
    const data = requests[0].data as { path: string; encoding: string; content: string };
    expect(data.path).toBe('/workspace/artifacts/cathedral.png');
    expect(data.encoding).toBe('base64');
    expect(data.content.length).toBeGreaterThan(0);
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
    expect(out).toMatch(/\/workspace\/artifacts\/flux-\d{8}-\d{6}\.png/);
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
    const pathMatch = out.match(/\/workspace\/artifacts\/[^\s]+\.png/);
    expect(pathMatch).not.toBeNull();
    const filename = pathMatch![0];
    expect(filename).not.toMatch(/\.\./);
    expect(filename).not.toMatch(/ /);
    expect(filename).toMatch(/evil_name_with_spaces/);
  });
});

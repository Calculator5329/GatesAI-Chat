import { describe, expect, it, vi } from 'vitest';
import { imageGenerateTool, pickFilenamePrefix } from '../../../src/services/tools/imageGenerate';
import type { ToolContext } from '../../../src/services/tools/types';
import type { ImageBackendId } from '../../../src/services/image/types';

interface FakeRequest { op: string; data: unknown }

function fakeBridge(opts: { online: boolean; requests?: FakeRequest[]; files?: Record<string, string> } = { online: true }): ToolContext['bridge'] {
  return {
    isOnline: opts.online,
    client: {
      request: async (op: string, data: unknown) => {
        opts.requests?.push({ op, data });
        if (op === 'fs.read') {
          const path = (data as { path: string }).path;
          return {
            path,
            content: opts.files?.[path] ?? '',
            encoding: 'utf8',
            size: (opts.files?.[path] ?? '').length,
            mime: 'application/json',
          };
        }
        return { path: (data as { path: string }).path, bytes: 1 };
      },
    },
    readAttachmentBase64: async () => null,
  } as unknown as ToolContext['bridge'];
}

function fakeImageGen(opts: {
  backend?: ImageBackendId;
  comfyBaseUrl?: string;
  openRouterApiKey?: string;
} = {}): ToolContext['imageGen'] {
  const backend = opts.backend ?? 'openrouter-image';
  return {
    backend,
    comfyWorkflowPath: undefined,
    getCredential: (id = backend) => {
      if (id === 'local-comfy') return opts.comfyBaseUrl ?? 'http://h:1';
      return opts.openRouterApiKey ?? 'sk-or-test';
    },
    toBackendConfig: () => ({
      primary: backend,
      comfyBaseUrl: opts.comfyBaseUrl,
      openRouterApiKey: opts.openRouterApiKey ?? 'sk-or-test',
    }),
  };
}

function fakeImageJobs(): { facade: ToolContext['imageJobs']; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const facade: ToolContext['imageJobs'] = {
    enqueue: vi.fn((input) => {
      calls.push(input as unknown as Record<string, unknown>);
      return { jobId: 'job-x', count: input.count };
    }),
  };
  return { facade, calls };
}

function makeCtx(overrides: Partial<ToolContext>): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    threadId: 't-test',
    ...overrides,
  } as unknown as ToolContext;
}

describe('image_generate tool', () => {
  it('allows either prompt or prompt_file at the tool-schema level', () => {
    expect(imageGenerateTool.def.parameters.required).toBeUndefined();
  });

  it('rejects empty prompts', async () => {
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: '   ' }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/`prompt` is required/);
  });

  it('reports a clear error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/bridge is offline/i);
  });

  it('reports a clear error when imageJobs subsystem is missing', async () => {
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }) });
    const out = await imageGenerateTool.execute({ prompt: 'a cat' }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/image-jobs subsystem/i);
  });

  it('rejects incomplete explicit pixel dimensions', async () => {
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ backend: 'local-comfy', comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1360 }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/width and height/i);
  });

  it('rejects explicit pixel dimensions that are not multiples of 16', async () => {
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ backend: 'local-comfy', comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1361, height: 768 }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/multiples of 16/i);
  });

  it('enqueues a job and returns image-job artifact', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    const out = await imageGenerateTool.execute({ prompt: 'a sunset', aspect_ratio: '16:9' }, ctx);
    expect(typeof out === 'string').toBe(false);
    if (typeof out === 'string') return;
    expect('content' in out).toBe(true);
    if (!('content' in out)) return;
    expect(out.artifacts).toEqual([{ kind: 'image-job', jobId: 'job-x', count: 1 }]);
    expect(out.content).toMatch(/Queued an image render/);
    expect(jobs.calls).toHaveLength(1);
    const c = jobs.calls[0];
    expect(c.prompt).toBe('a sunset');
    expect(c.threadId).toBe('t-test');
    expect(c.width).toBe(1344);
    expect(c.height).toBe(768);
    expect(c.count).toBe(1);
    expect(c.backend).toBe('openrouter-image');
  });

  it('clamps count to 1..10', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });

    await imageGenerateTool.execute({ prompt: 'x', count: 0 }, ctx);
    await imageGenerateTool.execute({ prompt: 'x', count: -3 }, ctx);
    await imageGenerateTool.execute({ prompt: 'x', count: 11 }, ctx);
    await imageGenerateTool.execute({ prompt: 'x', count: 4 }, ctx);

    expect(jobs.calls.map(c => c.count)).toEqual([1, 1, 10, 4]);
  });

  it('honors explicit width/height for local backends', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ backend: 'local-comfy', comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', width: 1360, height: 768, aspect_ratio: '1:1' }, ctx);
    expect(jobs.calls[0].width).toBe(1360);
    expect(jobs.calls[0].height).toBe(768);
  });

  it('ignores explicit width/height for OpenRouter image generation', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen(), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', width: 1360, height: 768, aspect_ratio: '1:1' }, ctx);
    expect(jobs.calls[0].width).toBe(1024);
    expect(jobs.calls[0].height).toBe(1024);
  });

  it('honors the backend override argument', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen(), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', backend: 'local-comfy' }, ctx);
    await imageGenerateTool.execute({ prompt: 'x', backend: 'openrouter' }, ctx);
    expect(jobs.calls.map(c => c.backend)).toEqual(['local-comfy', 'openrouter-image']);
  });

  it('forwards a rounded seed when provided', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', seed: 42.7 }, ctx);
    expect(jobs.calls[0].seed).toBe(42);
  });

  it('passes the AI-supplied filename through, slugified', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'whatever', filename: 'Starfleet Mountain Crash' }, ctx);
    expect(jobs.calls[0].filenamePrefix).toBe('starfleet-mountain-crash');
  });

  it('reads a prompt_file JSON and enqueues one job per prompt entry', async () => {
    const jobs = fakeImageJobs();
    const file = JSON.stringify({
      defaults: {
        count: 10,
        aspect_ratio: '16:9',
        seed: 1000,
      },
      prompts: [
        { prompt: 'portrait prompt one', filename: 'Portrait 001' },
        { prompt: 'portrait prompt two', count: 3, seed: 2000 },
      ],
    });
    const ctx = makeCtx({
      bridge: fakeBridge({ online: true, files: { '/workspace/artifacts/night-run.json': file } }),
      imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }),
      imageJobs: jobs.facade,
    });

    const out = await imageGenerateTool.execute({
      prompt_file: '/workspace/artifacts/night-run.json',
      batch_name: 'Night Run',
    }, ctx);

    expect(out).toEqual(expect.objectContaining({
      content: expect.stringMatching(/Queued 2 jobs \/ 13 image renders/),
      artifacts: [
        expect.objectContaining({ kind: 'image-job', count: 10 }),
        expect.objectContaining({ kind: 'image-job', count: 3 }),
      ],
    }));
    expect(jobs.calls).toEqual([
      expect.objectContaining({
        prompt: 'portrait prompt one',
        count: 10,
        width: 1344,
        height: 768,
        seed: 1000,
        filenamePrefix: 'night-run-portrait-001',
        backend: 'openrouter-image',
        notifyOnTerminal: false,
      }),
      expect.objectContaining({
        prompt: 'portrait prompt two',
        count: 3,
        width: 1344,
        height: 768,
        seed: 2000,
        filenamePrefix: 'night-run-portrait-prompt-two',
        backend: 'openrouter-image',
        notifyOnTerminal: true,
      }),
    ]);
  });

  it('rejects prompt_file batches above the safety cap', async () => {
    const jobs = fakeImageJobs();
    const file = JSON.stringify({
      prompts: Array.from({ length: 501 }, (_, i) => ({ prompt: `prompt ${i}` })),
    });
    const ctx = makeCtx({
      bridge: fakeBridge({ online: true, files: { '/workspace/artifacts/too-big.json': file } }),
      imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }),
      imageJobs: jobs.facade,
    });

    const out = await imageGenerateTool.execute({ prompt_file: '/workspace/artifacts/too-big.json' }, ctx);

    expect(typeof out === 'string' ? out : '').toMatch(/at most 500 prompts/i);
    expect(jobs.calls).toHaveLength(0);
  });

  it('validates a prompt_file batch before enqueueing any jobs', async () => {
    const jobs = fakeImageJobs();
    const file = JSON.stringify({
      prompts: [
        { prompt: 'valid prompt' },
        { prompt: 'bad dimensions', width: 123 },
      ],
    });
    const ctx = makeCtx({
      bridge: fakeBridge({ online: true, files: { '/workspace/artifacts/bad-batch.json': file } }),
      imageGen: fakeImageGen({ backend: 'local-comfy', comfyBaseUrl: 'http://h:1' }),
      imageJobs: jobs.facade,
    });

    const out = await imageGenerateTool.execute({ prompt_file: '/workspace/artifacts/bad-batch.json' }, ctx);

    expect(typeof out === 'string' ? out : '').toMatch(/width and height/i);
    expect(jobs.calls).toHaveLength(0);
  });

  it('falls back to a prompt-derived slug when no filename is provided', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'A serene lake at dusk' }, ctx);
    expect(jobs.calls[0].filenamePrefix).toBe('a-serene-lake-at-dusk');
  });
});

describe('pickFilenamePrefix', () => {
  it('slugifies an explicit filename, stripping punctuation and spaces', () => {
    expect(pickFilenamePrefix('My  Name!! 2.png', 'fallback')).toBe('my-name-2-png');
  });

  it('falls back to the prompt slug when filename is empty / non-string', () => {
    expect(pickFilenamePrefix(undefined, 'A serene lake')).toBe('a-serene-lake');
    expect(pickFilenamePrefix('   ', 'foo bar')).toBe('foo-bar');
    expect(pickFilenamePrefix(123, 'x y')).toBe('x-y');
  });

  it('returns "render" when both inputs would produce empty slugs', () => {
    expect(pickFilenamePrefix('', '!!!')).toBe('render');
  });

  it('caps the slug at 60 characters', () => {
    const long = 'a'.repeat(200);
    expect(pickFilenamePrefix(long, 'fallback')).toHaveLength(60);
  });
});

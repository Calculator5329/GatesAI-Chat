import { describe, expect, it, vi } from 'vitest';
import { imageGenerateTool } from '../../../src/services/tools/imageGenerate';
import type { ToolContext } from '../../../src/services/tools/types';

interface FakeRequest { op: string; data: unknown }

function fakeBridge(opts: { online: boolean; requests?: FakeRequest[] } = { online: true }): ToolContext['bridge'] {
  return {
    isOnline: opts.online,
    client: {
      request: async (op: string, data: unknown) => {
        opts.requests?.push({ op, data });
        return { path: (data as { path: string }).path, bytes: 1 };
      },
    },
    readAttachmentBase64: async () => null,
  } as unknown as ToolContext['bridge'];
}

function fakeImageGen(opts: {
  backend?: 'local-comfy' | 'local-a1111';
  comfyBaseUrl?: string;
  a1111BaseUrl?: string;
} = {}): ToolContext['imageGen'] {
  const backend = opts.backend ?? 'local-comfy';
  return {
    backend,
    comfyWorkflowPath: undefined,
    getCredential: () => 'ok',
    toBackendConfig: () => ({
      primary: backend,
      comfyBaseUrl: opts.comfyBaseUrl,
      a1111BaseUrl: opts.a1111BaseUrl,
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
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1360 }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/width and height/i);
  });

  it('rejects explicit pixel dimensions that are not multiples of 16', async () => {
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: fakeImageJobs().facade });
    const out = await imageGenerateTool.execute({ prompt: 'a lake', width: 1361, height: 768 }, ctx);
    expect(typeof out === 'string' ? out : '').toMatch(/multiples of 16/i);
  });

  it('enqueues a job and returns image-job artifact', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    const out = await imageGenerateTool.execute({ prompt: 'a sunset', aspect_ratio: '16:9' }, ctx);
    expect(typeof out === 'string').toBe(false);
    if (typeof out === 'string') return;
    expect(out.artifacts).toEqual([{ kind: 'image-job', jobId: 'job-x', count: 1 }]);
    expect(out.content).toMatch(/Queued an image render/);
    expect(jobs.calls).toHaveLength(1);
    const c = jobs.calls[0];
    expect(c.prompt).toBe('a sunset');
    expect(c.threadId).toBe('t-test');
    expect(c.width).toBe(1344);
    expect(c.height).toBe(768);
    expect(c.count).toBe(1);
    expect(c.backend).toBe('local-comfy');
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
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', width: 1360, height: 768, aspect_ratio: '1:1' }, ctx);
    expect(jobs.calls[0].width).toBe(1360);
    expect(jobs.calls[0].height).toBe(768);
  });

  it('forwards a rounded seed when provided', async () => {
    const jobs = fakeImageJobs();
    const ctx = makeCtx({ bridge: fakeBridge(), imageGen: fakeImageGen({ comfyBaseUrl: 'http://h:1' }), imageJobs: jobs.facade });
    await imageGenerateTool.execute({ prompt: 'x', seed: 42.7 }, ctx);
    expect(jobs.calls[0].seed).toBe(42);
  });
});

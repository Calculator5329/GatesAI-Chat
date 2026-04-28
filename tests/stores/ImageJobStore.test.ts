import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImageJobStore,
  type ImageJobBridgeFacade,
  type ImageJobImageGenFacade,
  type ImageJobStoreDeps,
} from '../../src/stores/ImageJobStore';
import type { ImageJobInput } from '../../src/services/image/jobs/types';
import type { GenerateImageRequest, GenerateImageResult } from '../../src/services/image/types';
import type { ImageBackendConfig } from '../../src/services/image/imageBackend';
import { clearAppStorage } from '../helpers/storage';

const INPUT: ImageJobInput = {
  threadId: 't1',
  prompt: 'a sunset',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
};

function fakeBridge(): ImageJobBridgeFacade {
  return {
    isOnline: true,
    client: {
      request: async <T = unknown>(_op: string, data: unknown): Promise<T> => {
        const path = (data as { path: string }).path;
        return { path, bytes: 10 } as T;
      },
    },
  };
}

function fakeImageGen(): ImageJobImageGenFacade {
  return {
    comfyWorkflowPath: undefined,
    toBackendConfig: () => ({
      primary: 'local-comfy',
      comfyBaseUrl: 'http://127.0.0.1:8188',
      comfyQualityPreset: 'quick',
    }),
  };
}

function makeDeps(overrides: Partial<ImageJobStoreDeps> = {}): ImageJobStoreDeps {
  return {
    bridge: fakeBridge(),
    imageGen: fakeImageGen(),
    progressFactory: () => null,
    dispatcher: async (req: GenerateImageRequest, _config: ImageBackendConfig) => ({
      result: {
        base64: 'AAAA',
        mime: 'image/png',
        width: req.width,
        height: req.height,
        seed: req.seed,
        endpoint: 'mock',
        backend: 'local-comfy',
      } as GenerateImageResult,
    }),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function pendingDispatcherDeps(): ImageJobStoreDeps {
  return makeDeps({
    // Never resolves — job stays in flight so synchronous cancel works.
    dispatcher: () => new Promise(() => {}),
  });
}

describe('ImageJobStore (queue management)', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('starts with empty queue and history', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    expect(store.queue).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.active).toBeNull();
  });

  it('enqueue() returns a stable id and pushes onto the queue', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    const { jobId, count } = store.enqueue(INPUT);
    expect(typeof jobId).toBe('string');
    expect(count).toBe(1);
    const job = store.findById(jobId);
    expect(job).not.toBeNull();
    expect(job?.prompt).toBe('a sunset');
  });

  it('cancel() removes the job and marks cancelled in history', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    expect(store.queue).toEqual([]);
    expect(store.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('history rehydrates from localStorage on next construction', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    const store2 = new ImageJobStore();
    expect(store2.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('delete() removes a job from history', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    store.delete(jobId);
    expect(store.history.find(j => j.id === jobId)).toBeUndefined();
  });

  it('clearHistory() empties history and storage', () => {
    const store = new ImageJobStore(pendingDispatcherDeps());
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    expect(store.history.length).toBeGreaterThan(0);
    store.clearHistory();
    expect(store.history).toEqual([]);
    const store2 = new ImageJobStore();
    expect(store2.history).toEqual([]);
  });
});

describe('ImageJobStore (runner)', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('runs a queued job to completion via the injected dispatcher', async () => {
    const store = new ImageJobStore(makeDeps());
    const { jobId } = store.enqueue(INPUT);
    // Wait for the runner microtask + write.
    await flushMicrotasks();
    await flushMicrotasks();
    const job = store.history.find(j => j.id === jobId);
    expect(job?.status).toBe('done');
    expect(job?.results).toHaveLength(1);
    expect(job?.results[0]).toMatch(/\/workspace\/artifacts\//);
  });

  it('persists hosted backend URLs into workspace artifacts for reliable gallery loading', async () => {
    const writes: Array<{ path: string; content: string; encoding: string }> = [];
    const bridge: ImageJobBridgeFacade = {
      isOnline: true,
      client: {
        request: async <T = unknown>(_op: string, data: unknown): Promise<T> => {
          writes.push(data as { path: string; content: string; encoding: string });
          return { path: (data as { path: string }).path, bytes: 10 } as T;
        },
      },
    };
    const deps = makeDeps({
      bridge,
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
      dispatcher: async (req: GenerateImageRequest) => ({
        result: {
          url: 'http://127.0.0.1:8188/view?filename=a.png&type=output',
          mime: 'image/png',
          width: req.width,
          height: req.height,
          seed: req.seed,
          endpoint: 'mock',
          backend: 'local-comfy',
        } as GenerateImageResult,
      }),
    });
    const store = new ImageJobStore(deps);

    const { jobId } = store.enqueue(INPUT);
    for (let i = 0; i < 10; i++) await flushMicrotasks();

    const job = store.history.find(j => j.id === jobId);
    expect(job?.status).toBe('done');
    expect(job?.results[0]).toMatch(/^\/workspace\/artifacts\/comfy-/);
    expect(writes).toEqual([expect.objectContaining({
      encoding: 'base64',
      content: 'AQID',
    })]);
  });

  it('multi-image (count: 3) writes three files and accumulates results', async () => {
    const writes: string[] = [];
    const bridge: ImageJobBridgeFacade = {
      isOnline: true,
      client: {
        request: async <T = unknown>(_op: string, data: unknown): Promise<T> => {
          const path = (data as { path: string }).path;
          writes.push(path);
          return { path, bytes: 10 } as T;
        },
      },
    };
    const deps = makeDeps({ bridge });
    const store = new ImageJobStore(deps);
    const { jobId } = store.enqueue({ ...INPUT, count: 3 });
    for (let i = 0; i < 10; i++) await flushMicrotasks();
    const job = store.history.find(j => j.id === jobId);
    expect(job?.status).toBe('done');
    expect(job?.results).toHaveLength(3);
    expect(writes).toHaveLength(3);
  });

  it('failed dispatch lands the job in history with status=failed', async () => {
    const deps = makeDeps({
      dispatcher: async () => { throw new Error('upstream boom'); },
    });
    const store = new ImageJobStore(deps);
    const { jobId } = store.enqueue(INPUT);
    await flushMicrotasks();
    await flushMicrotasks();
    const job = store.history.find(j => j.id === jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toMatch(/upstream boom/);
  });

  it('reports cumulative progress across all iterations of a multi-image job', async () => {
    // Runner has the shape: progress events arrive while a single
    // dispatch is running; iteration boundary advances by 100 units. We
    // hold the dispatcher open so we can pump progress events ourselves
    // and observe `job.progress` between iterations.
    let resolveCurrent: (() => void) | null = null;
    let dispatchCount = 0;
    type Emit = (e: { value: number; max: number }) => void;
    let progressEmit: Emit | null = null;

    const deps = makeDeps({
      dispatcher: async (req: GenerateImageRequest) => {
        dispatchCount++;
        await new Promise<void>(r => { resolveCurrent = r; });
        return {
          result: {
            base64: 'A', mime: 'image/png',
            width: req.width, height: req.height, seed: req.seed,
            endpoint: 'mock', backend: 'local-comfy',
          } as GenerateImageResult,
        };
      },
      progressFactory: () => ({
        subscribe: (handler: (e: { value: number; max: number }) => void) => {
          progressEmit = handler;
          return () => { progressEmit = null; };
        },
        cancel: async () => {},
        dispose: () => {},
      }),
    });

    const store = new ImageJobStore(deps);
    const { jobId } = store.enqueue({ ...INPUT, count: 4 });

    // Wait for the first iteration to begin dispatch.
    for (let i = 0; i < 10 && dispatchCount === 0; i++) await flushMicrotasks();

    const job = () => store.findById(jobId);

    // max should be count * 100 = 400 from the first reset.
    expect(job()?.progress?.max).toBe(400);
    // First iteration starts at 0.
    expect(job()?.progress?.value).toBe(0);

    // Halfway through iteration 0: backend reports 50/100. Cumulative = 50.
    (progressEmit as Emit | null)?.({ value: 50, max: 100 });
    expect(job()?.progress?.value).toBe(50);
    expect(job()?.progress?.max).toBe(400);

    // Finish iteration 0 — runner advances bar to 100/400, then starts iter 1 at 100/400.
    (resolveCurrent as (() => void) | null)?.();
    for (let i = 0; i < 10 && dispatchCount < 2; i++) await flushMicrotasks();
    expect(job()?.progress?.value).toBe(100);

    // Halfway through iteration 1: backend reports 50/100. Cumulative = 150.
    (progressEmit as Emit | null)?.({ value: 50, max: 100 });
    expect(job()?.progress?.value).toBe(150);

    // Drain remaining iterations.
    for (let it = 1; it < 4; it++) {
      (resolveCurrent as (() => void) | null)?.();
      for (let i = 0; i < 10 && dispatchCount < it + 2; i++) await flushMicrotasks();
    }
    for (let i = 0; i < 10; i++) await flushMicrotasks();

    expect(store.history.find(j => j.id === jobId)?.status).toBe('done');
  });

  it('cancel during a running multi-image job marks cancelled and stops further iterations', async () => {
    let calls = 0;
    const deps = makeDeps({
      dispatcher: vi.fn(async (req: GenerateImageRequest) => {
        calls++;
        await new Promise(r => setTimeout(r, 10));
        return {
          result: {
            base64: 'A',
            mime: 'image/png',
            width: req.width,
            height: req.height,
            seed: req.seed,
            endpoint: 'mock',
            backend: 'local-comfy',
          } as GenerateImageResult,
        };
      }),
    });
    const store = new ImageJobStore(deps);
    const { jobId } = store.enqueue({ ...INPUT, count: 5 });
    // Let the first iteration begin.
    await new Promise(r => setTimeout(r, 5));
    store.cancel(jobId);
    // Let any in-flight iteration settle.
    await new Promise(r => setTimeout(r, 50));
    const job = store.history.find(j => j.id === jobId);
    expect(job?.status).toBe('cancelled');
    expect(calls).toBeLessThan(5);
  });
});

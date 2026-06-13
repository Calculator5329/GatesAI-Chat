import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageJobCard, imageFailureAdvice, pickImageJobCardVariant } from '../../../src/components/editorial/ImageJobCard';
import { __imageCacheTestApi, loadImageSource } from '../../../src/components/media/useImageDataUrl';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import { StoreProvider } from '../../../src/stores/context';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ImageJob, CompletedJob } from '../../../src/services/image/jobs/types';
import { flush } from '../../helpers/mockProvider';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderCard(store: RootStore, jobId: string): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store,
        children: createElement(ImageJobCard, { jobId, expectedCount: 2 }),
      }),
    );
  });
  return host;
}

function minimalStore(imageJobs: ImageJobStore, bridge: BridgeStore): RootStore {
  return {
    registry: {} as RootStore['registry'],
    providers: {} as RootStore['providers'],
    profile: {} as RootStore['profile'],
    chat: {} as RootStore['chat'],
    ui: {} as RootStore['ui'],
    router: {} as RootStore['router'],
    bridge,
    execStream: {} as RootStore['execStream'],
    localRuntime: {} as RootStore['localRuntime'],
    imageJobs,
  } as RootStore;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  __imageCacheTestApi.reset();
});

const baseJob: ImageJob = {
  id: 'j',
  threadId: 't',
  prompt: 'p',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
  status: 'pending',
  results: [],
  createdAt: 1,
};

describe('pickImageJobCardVariant', () => {
  it('returns "missing" when there is no job', () => {
    expect(pickImageJobCardVariant(null)).toBe('missing');
  });

  it('returns "running" for pending and running jobs', () => {
    expect(pickImageJobCardVariant({ ...baseJob, status: 'pending' })).toBe('running');
    expect(pickImageJobCardVariant({ ...baseJob, status: 'running' })).toBe('running');
  });

  it('returns terminal-state variants', () => {
    const failed: CompletedJob = { ...baseJob, status: 'failed', error: 'x' };
    const cancelled: CompletedJob = { ...baseJob, status: 'cancelled' };
    expect(pickImageJobCardVariant(failed)).toBe('failed');
    expect(pickImageJobCardVariant(cancelled)).toBe('cancelled');
  });

  it('distinguishes single vs grid done states', () => {
    const single: CompletedJob = { ...baseJob, status: 'done', results: ['/workspace/artifacts/a.png'] };
    const grid: CompletedJob = { ...baseJob, status: 'done', results: ['/a.png', '/b.png', '/c.png'] };
    const empty: CompletedJob = { ...baseJob, status: 'done', results: [] };
    expect(pickImageJobCardVariant(single)).toBe('done-single');
    expect(pickImageJobCardVariant(grid)).toBe('done-grid');
    expect(pickImageJobCardVariant(empty)).toBe('done-empty');
  });
});

describe('ImageJobCard UI (Batch D)', () => {
  beforeEach(() => clearAppStorage());

  it('shows partial thumbnails and cancel copy when a job was cancelled mid-batch', async () => {
    const imageJobs = new ImageJobStore();
    const bridge = new BridgeStore();
    runInAction(() => { bridge.state = 'online'; });
    vi.spyOn(bridge, 'readAttachmentBase64').mockResolvedValue({ base64: 'AAA=', mime: 'image/png', size: 3 });

    runInAction(() => {
      imageJobs.history.push({
        ...baseJob,
        id: 'cancelled-partial',
        status: 'cancelled',
        results: ['/workspace/artifacts/images/local/a.png'],
        count: 2,
      });
    });

    const rendered = renderCard(minimalStore(imageJobs, bridge), 'cancelled-partial');
    expect(rendered.textContent).toContain('Render cancelled');
    expect(rendered.textContent).toContain('(1 of 2 completed before cancel)');
    await flush(10);
  });

  it('shows Image file missing when the workspace artifact cannot be loaded', async () => {
    const imageJobs = new ImageJobStore();
    const bridge = new BridgeStore();
    runInAction(() => { bridge.state = 'online'; });
    vi.spyOn(bridge, 'readAttachmentBase64').mockResolvedValue(null);

    runInAction(() => {
      imageJobs.history.push({
        ...baseJob,
        id: 'done-missing-file',
        status: 'done',
        results: ['/workspace/artifacts/images/local/missing.png'],
      });
    });

    const rendered = renderCard(minimalStore(imageJobs, bridge), 'done-missing-file');
    // State-based wait: poll until the failed artifact load renders the
    // missing-file notice instead of sleeping a fixed 50ms. Each poll runs an
    // empty act() so React flushes the MobX-triggered update before we read
    // the DOM.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(rendered.textContent).toContain('Image file missing');
    });
  });

  it('shows waiting-provider copy when OpenRouter synthetic progress reaches its cap', () => {
    const imageJobs = new ImageJobStore();
    const bridge = new BridgeStore();
    runInAction(() => {
      bridge.state = 'online';
      imageJobs.active = {
        ...baseJob,
        id: 'openrouter-waiting',
        backend: 'openrouter-image',
        status: 'running',
        startedAt: Date.now() - 130_000,
        progress: { value: 92, max: 100 },
      };
    });

    const rendered = renderCard(minimalStore(imageJobs, bridge), 'openrouter-waiting');
    expect(rendered.textContent).toContain('Waiting on provider...');
    expect(rendered.textContent).toContain('OpenRouter remote render');
  });
});

describe('imageFailureAdvice', () => {
  it('points OpenRouter auth failures at Models settings', () => {
    const failed: CompletedJob = {
      ...baseJob,
      backend: 'openrouter-image',
      status: 'failed',
      error: 'OpenRouter image generation failed 401 Unauthorized',
    };

    expect(imageFailureAdvice(failed)).toMatch(/OpenRouter API key in Models/i);
  });

  it('points local fetch failures at ComfyUI availability', () => {
    const failed: CompletedJob = {
      ...baseJob,
      backend: 'local-comfy',
      status: 'failed',
      error: 'failed to fetch generated image',
    };

    expect(imageFailureAdvice(failed)).toMatch(/ComfyUI is online/i);
  });
});

describe('imageCache (LRU bounded)', () => {
  // The previous Map was unbounded. Each entry is a base64 data URL of an
  // SDXL/FLUX render — typically 2–7 MB. After ~200–500 generated images
  // a long session would balloon WebView memory past the per-process cap
  // and crash the renderer with no visible warning. The cache is now
  // bounded to {limit} entries with LRU eviction.
  beforeEach(() => __imageCacheTestApi.reset());

  it('evicts the oldest entry once the limit is exceeded', () => {
    const limit = __imageCacheTestApi.limit;
    expect(limit).toBeGreaterThan(0);

    // Fill exactly to the cap.
    for (let i = 0; i < limit; i++) {
      __imageCacheTestApi.set(`/workspace/artifacts/img-${i}.png`, `data:image/png;base64,AAA${i}`);
    }
    expect(__imageCacheTestApi.size()).toBe(limit);
    expect(__imageCacheTestApi.has('/workspace/artifacts/img-0.png')).toBe(true);

    // Insert one more — oldest must be evicted, size stays at the cap.
    __imageCacheTestApi.set('/workspace/artifacts/img-overflow.png', 'data:image/png;base64,ZZZ');
    expect(__imageCacheTestApi.size()).toBe(limit);
    expect(__imageCacheTestApi.has('/workspace/artifacts/img-0.png')).toBe(false);
    expect(__imageCacheTestApi.has('/workspace/artifacts/img-overflow.png')).toBe(true);
  });

  it('refreshes recency on read so frequently-viewed images survive eviction', () => {
    const limit = __imageCacheTestApi.limit;
    for (let i = 0; i < limit; i++) {
      __imageCacheTestApi.set(`/p-${i}.png`, `data:image/png;base64,${i}`);
    }
    // Touch the OLDEST entry — should bump it to most-recent.
    expect(__imageCacheTestApi.get('/p-0.png')).toBeDefined();

    // Insert a fresh entry, forcing one eviction.
    __imageCacheTestApi.set('/new.png', 'data:image/png;base64,N');

    // The actually-oldest is now `/p-1.png`, not `/p-0.png`, because we
    // touched `/p-0.png` and that bumped its recency.
    expect(__imageCacheTestApi.has('/p-0.png')).toBe(true);
    expect(__imageCacheTestApi.has('/p-1.png')).toBe(false);
    expect(__imageCacheTestApi.has('/new.png')).toBe(true);
  });

  it('overwriting an existing key keeps size stable (no double-counting)', () => {
    __imageCacheTestApi.set('/p.png', 'data:image/png;base64,A');
    __imageCacheTestApi.set('/p.png', 'data:image/png;base64,B');
    expect(__imageCacheTestApi.size()).toBe(1);
    expect(__imageCacheTestApi.get('/p.png')).toBe('data:image/png;base64,B');
  });

  it('dedupes concurrent bridge reads for the same image path', async () => {
    let reads = 0;
    const bridge = {
      readAttachmentBase64: async () => {
        reads++;
        await Promise.resolve();
        return { mime: 'image/png', base64: 'AAA=' };
      },
    };

    const [a, b] = await Promise.all([
      loadImageSource(bridge as never, '/workspace/artifacts/a.png'),
      loadImageSource(bridge as never, '/workspace/artifacts/a.png'),
    ]);

    expect(a).toBe('data:image/png;base64,AAA=');
    expect(b).toBe('data:image/png;base64,AAA=');
    expect(reads).toBe(1);
    expect(__imageCacheTestApi.inflightSize()).toBe(0);
  });

  it('keeps separate cache entries for different attachment cache keys on the same path', async () => {
    let reads = 0;
    const bridge = {
      readAttachmentBase64: async () => {
        reads++;
        return { mime: 'image/png', base64: reads === 1 ? 'AAA=' : 'BBB=' };
      },
    };

    const a = await loadImageSource(bridge as never, '/workspace/attachments/image.png', 'att-a');
    const b = await loadImageSource(bridge as never, '/workspace/attachments/image.png', 'att-b');

    expect(a).toBe('data:image/png;base64,AAA=');
    expect(b).toBe('data:image/png;base64,BBB=');
    expect(reads).toBe(2);
    expect(__imageCacheTestApi.has('att-a')).toBe(true);
    expect(__imageCacheTestApi.has('att-b')).toBe(true);
  });
});

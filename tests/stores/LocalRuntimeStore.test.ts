import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observable, runInAction } from 'mobx';
import type { ComfyDiscovery } from '../../src/services/image/comfyDiscovery';
import { localRuntimeService } from '../../src/services/local/localRuntimeService';
import {
  LocalRuntimeStore,
  PROBE_INTERVAL_ONLINE_MS,
  type LocalRuntimeStoreDeps,
} from '../../src/stores/LocalRuntimeStore';
import { clearAppStorage } from '../helpers/storage';

const TAGS = { models: [{ name: 'qwen3.5:4b', capabilities: ['completion', 'tools'] }] };
const UNREACHABLE = async (): Promise<never> => { throw new TypeError('Failed to fetch'); };

type FetchTags = (baseUrl: string, apiKey?: string) => Promise<unknown>;
type FindComfy = NonNullable<LocalRuntimeStoreDeps['findComfy']>;

function comfyResult(patch: Partial<ComfyDiscovery> = {}): ComfyDiscovery {
  const baseUrl = patch.baseUrl ?? 'http://127.0.0.1:8188';
  return {
    baseUrl,
    online: false,
    error: `Nothing is answering at ${baseUrl}`,
    checkpoints: [],
    diffusionModels: [],
    preset: null,
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Asserts the next scheduled call to `fn` lands exactly `ms` from now. */
async function expectNextCallAfter(fn: { mock: { calls: unknown[] } }, ms: number): Promise<void> {
  const before = fn.mock.calls.length;
  await vi.advanceTimersByTimeAsync(ms - 1);
  expect(fn.mock.calls).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn.mock.calls).toHaveLength(before + 1);
}

function harness(options: { fetchOllamaTags?: FetchTags; findComfy?: FindComfy; probesEnabled?: boolean } = {}) {
  let onWake: () => void = () => {};
  const fetchOllamaTags = vi.fn<FetchTags>(options.fetchOllamaTags ?? (async () => TAGS));
  const findComfy = vi.fn<FindComfy>(options.findComfy ?? (async url => comfyResult({ baseUrl: url })));
  const apiKey = observable.box<string | undefined>(undefined);
  const applied: unknown[] = [];
  const store = new LocalRuntimeStore({
    service: { fetchOllamaTags },
    findComfy,
    subscribeToWake: listener => {
      onWake = listener;
      return () => { onWake = () => {}; };
    },
    probesEnabled: options.probesEnabled,
  });
  store.attachOllamaCatalog({ apiKey: () => apiKey.get(), applyTags: raw => applied.push(raw), catalog: () => [] });
  return {
    store,
    fetchOllamaTags,
    findComfy,
    applied,
    wake: () => onWake(),
    setKey: (key: string | undefined) => runInAction(() => apiKey.set(key)),
  };
}

describe('LocalRuntimeStore reachability', () => {
  beforeEach(() => {
    clearAppStorage();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAppStorage();
  });

  it('finds an Ollama that GatesAI did not start, with no user action', async () => {
    const { store, fetchOllamaTags, applied } = harness();

    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchOllamaTags).toHaveBeenCalledWith('http://127.0.0.1:11434', undefined);
    expect(store.runtimes.ollama.status).toBe('online');
    expect(store.runtimes.ollama.lastError).toBeUndefined();
    expect(applied).toEqual([TAGS]);
    store.dispose();
  });

  it('notices Ollama going away and coming back on the 60 s and 10 s schedule', async () => {
    let up = true;
    const { store, fetchOllamaTags } = harness({
      fetchOllamaTags: async () => {
        if (!up) throw new TypeError('Failed to fetch');
        return TAGS;
      },
    });
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.runtimes.ollama.status).toBe('online');

    up = false;
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_ONLINE_MS);
    expect(store.runtimes.ollama.status).toBe('offline');
    expect(store.runtimes.ollama.lastError).toBe('Nothing is answering at http://127.0.0.1:11434.');

    up = true;
    await expectNextCallAfter(fetchOllamaTags, 10_000);
    expect(store.runtimes.ollama.status).toBe('online');
    store.dispose();
  });

  it('backs off while nothing answers: 10 s, 30 s, 60 s, then every 5 min', async () => {
    const { store, fetchOllamaTags, findComfy } = harness({ fetchOllamaTags: UNREACHABLE });
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    for (const gap of [10_000, 30_000, 60_000, 300_000, 300_000]) {
      await expectNextCallAfter(fetchOllamaTags, gap);
    }
    expect(findComfy).toHaveBeenCalledTimes(fetchOllamaTags.mock.calls.length);
    store.dispose();
  });

  it('still probes at once on wake while backed off, and starts over after answering', async () => {
    let up = false;
    const { store, fetchOllamaTags, wake } = harness({
      fetchOllamaTags: async () => {
        if (!up) throw new TypeError('Failed to fetch');
        return TAGS;
      },
    });
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(10_000 + 30_000 + 60_000);

    up = true;
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.runtimes.ollama.status).toBe('online');

    up = false;
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_ONLINE_MS);
    expect(store.runtimes.ollama.status).toBe('offline');
    await expectNextCallAfter(fetchOllamaTags, 10_000);
    store.dispose();
  });

  it.each([
    ['the address changes', (store: LocalRuntimeStore) => { store.setBaseUrl('ollama', 'gpu-box'); }],
    ['someone asks to check again', (store: LocalRuntimeStore) => { void store.probe('ollama', { fresh: true }); }],
  ])('returns to the 10 s cadence when %s', async (_trigger, restart) => {
    const { store, fetchOllamaTags } = harness({ fetchOllamaTags: UNREACHABLE });
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(10_000 + 30_000 + 60_000);
    expect(fetchOllamaTags).toHaveBeenCalledTimes(4);

    restart(store);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchOllamaTags).toHaveBeenCalledTimes(5);
    await expectNextCallAfter(fetchOllamaTags, 10_000);
    store.dispose();
  });

  it('probes again when the window wakes', async () => {
    const { store, fetchOllamaTags, findComfy, wake } = harness();
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    wake();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchOllamaTags).toHaveBeenCalledTimes(2);
    expect(findComfy).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('probes the new address as soon as it changes', async () => {
    const { store, fetchOllamaTags } = harness();
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    store.setBaseUrl('ollama', '192.168.1.20');

    expect(store.ollamaBaseUrl).toBe('http://192.168.1.20:11434');
    expect(fetchOllamaTags).toHaveBeenLastCalledWith('http://192.168.1.20:11434', undefined);
    store.dispose();
  });

  it('probes again with the key as soon as the Ollama API key changes', async () => {
    const { store, fetchOllamaTags, setKey } = harness();
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    setKey('remote-test-key');

    expect(fetchOllamaTags).toHaveBeenLastCalledWith('http://127.0.0.1:11434', 'remote-test-key');
    store.dispose();
  });

  it('never runs two probes for one runtime at once', async () => {
    const pending = deferred<unknown>();
    const { store, fetchOllamaTags, wake } = harness({ fetchOllamaTags: () => pending.promise });
    store.startMonitoring();

    void store.probe('ollama');
    wake();
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_ONLINE_MS * 3);

    expect(fetchOllamaTags).toHaveBeenCalledTimes(1);
    expect(store.runtimes.ollama.checking).toBe(true);
    pending.resolve(TAGS);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.runtimes.ollama.status).toBe('online');
    expect(store.runtimes.ollama.checking).toBe(false);
    store.dispose();
  });

  it('drops an answer for an address that changed while the probe was in flight', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const answers = [first.promise, second.promise];
    const { store, fetchOllamaTags, applied } = harness({ fetchOllamaTags: () => answers.shift() ?? Promise.resolve(TAGS) });
    store.startMonitoring();

    store.setBaseUrl('ollama', 'gpu-box');
    first.resolve(TAGS);
    await vi.advanceTimersByTimeAsync(0);

    expect(applied).toEqual([]);
    expect(fetchOllamaTags).toHaveBeenLastCalledWith('http://gpu-box:11434', undefined);
    second.reject(new Error('Ollama 401'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.runtimes.ollama.status).toBe('offline');
    expect(store.runtimes.ollama.lastError).toContain('Check the Ollama API key');
    store.dispose();
  });

  it('says so when something other than Ollama answers', async () => {
    const { store } = harness({ fetchOllamaTags: async () => ({ hello: 'world' }) });

    await store.probe('ollama');

    expect(store.runtimes.ollama.status).toBe('offline');
    expect(store.runtimes.ollama.lastError).toBe("http://127.0.0.1:11434 answered, but it isn't Ollama.");
  });

  it('points at port 11434 when a web page answers on the default web port', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><title>Router admin</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    const { store } = harness({ fetchOllamaTags: (baseUrl, apiKey) => localRuntimeService.fetchOllamaTags(baseUrl, apiKey) });
    store.setBaseUrl('ollama', 'http://gpu-box');

    await store.probe('ollama');

    expect(store.runtimes.ollama.status).toBe('offline');
    expect(store.runtimes.ollama.lastError).toBe(
      "http://gpu-box answered, but it isn't Ollama. Ollama usually listens on port 11434, for example http://gpu-box:11434.",
    );
  });

  it('sends nothing for a fresh probe that was still waiting when the store was disposed', async () => {
    const pending = deferred<unknown>();
    const { store, fetchOllamaTags } = harness({ fetchOllamaTags: () => pending.promise });
    void store.probe('ollama');
    const fresh = store.probe('ollama', { fresh: true });

    store.dispose();
    pending.resolve(TAGS);
    await fresh;

    expect(fetchOllamaTags).toHaveBeenCalledTimes(1);
  });

  it('stops probing after dispose', async () => {
    const { store, fetchOllamaTags } = harness({ fetchOllamaTags: async () => { throw new Error('down'); } });
    store.startMonitoring();
    await vi.advanceTimersByTimeAsync(0);

    store.dispose();
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_ONLINE_MS * 2);

    expect(fetchOllamaTags).toHaveBeenCalledTimes(1);
  });

  it('uses the ComfyUI that discovery finds and remembers its address', async () => {
    const { store, findComfy } = harness({
      findComfy: async () => comfyResult({
        baseUrl: 'http://127.0.0.1:8000',
        online: true,
        error: undefined,
        checkpoints: ['sdxl_lightning_4step.safetensors'],
        preset: { kind: 'sdxl-lightning' },
      }),
    });

    await store.probe('comfyui');

    expect(findComfy).toHaveBeenCalledWith('http://127.0.0.1:8188');
    expect(store.comfyReady).toBe(true);
    expect(store.comfyBaseUrl).toBe('http://127.0.0.1:8000');
    expect(store.runtimes.comfyui.status).toBe('online');
    expect(harness().store.comfyBaseUrl).toBe('http://127.0.0.1:8000');
  });

  it('is not image-ready when ComfyUI runs without a usable model', async () => {
    const { store } = harness({ findComfy: async url => comfyResult({ baseUrl: url, online: true, error: undefined }) });

    await store.probe('comfyui');

    expect(store.runtimes.comfyui.status).toBe('online');
    expect(store.comfyReady).toBe(false);
    expect(store.runtimes.comfyui.lastError).toContain('no image model');
  });

  it('stays off in Web Lite', async () => {
    const { store, fetchOllamaTags, findComfy } = harness({ probesEnabled: false });

    store.startMonitoring();
    await store.probe('ollama');
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_ONLINE_MS);

    expect(fetchOllamaTags).not.toHaveBeenCalled();
    expect(findComfy).not.toHaveBeenCalled();
    expect(store.runtimes.ollama.status).toBe('offline');
    expect(store.runtimes.ollama.lastError).toBe('Local models need the GatesAI desktop app.');
  });
});

describe('LocalRuntimeStore settings', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('ignores legacy URL fields on the Ollama and image-gen storage keys', () => {
    localStorage.setItem('gatesai.ollama.v1', JSON.stringify({ baseUrl: 'http://10.0.0.12:11434', toolsEnabled: true, catalog: [] }));
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({ backend: 'local-comfy', comfyBaseUrl: 'http://10.0.0.13:8188' }));

    const { store } = harness();

    expect(store.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(store.comfyBaseUrl).toBe('http://127.0.0.1:8188');
  });

  it('prefers local models by default and persists the setting', () => {
    const { store } = harness();
    expect(store.preferLocalModels).toBe(true);

    store.setPreferLocalModels(false);

    expect(harness().store.preferLocalModels).toBe(false);
  });
});

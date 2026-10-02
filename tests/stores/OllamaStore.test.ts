import { autorun, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaStore } from '../../src/stores/OllamaStore';
import { LocalRuntimeStore } from '../../src/stores/LocalRuntimeStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';

const TAGS_OK = {
  models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4.7e9, modified_at: '2026-04-20T00:00:00Z' }],
};

const STARTER_TAGS = {
  models: [{ name: 'qwen3.5:4b', model: 'qwen3.5:4b', size: 3.4e9, modified_at: '2026-04-20T00:00:00Z' }],
};

type FetchTags = (baseUrl: string, apiKey?: string) => Promise<unknown>;

function makeLocalRuntime(fetchOllamaTags: FetchTags = async () => ({ models: [] })): LocalRuntimeStore {
  return new LocalRuntimeStore({
    service: { fetchOllamaTags },
    findComfy: async () => ({ baseUrl: 'http://127.0.0.1:8188', online: false, checkpoints: [], diffusionModels: [], preset: null }),
    subscribeToWake: () => () => {},
  });
}

describe('OllamaStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('starts with empty catalog and reads URL from LocalRuntimeStore', () => {
    const local = makeLocalRuntime();
    const store = new OllamaStore(new ModelRegistry(), local);
    expect(local.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(store.catalog).toEqual([]);
    expect(store.config.toolsEnabled).toBe(true);
  });

  it('derives online from LocalRuntimeStore status', () => {
    const local = makeLocalRuntime();
    const store = new OllamaStore(new ModelRegistry(), local);
    expect(store.online).toBe(false);
    runInAction(() => { local.runtimes.ollama.status = 'online'; });
    expect(store.online).toBe(true);
    runInAction(() => { local.runtimes.ollama.status = 'offline'; });
    expect(store.online).toBe(false);
  });

  it('refresh() loads /api/tags through LocalRuntimeStore', async () => {
    const fetchTags = vi.fn<FetchTags>(async () => TAGS_OK);
    const reg = new ModelRegistry();
    const local = makeLocalRuntime(fetchTags);
    local.setBaseUrl('ollama', 'http://10.0.0.5:11434');
    const store = new OllamaStore(reg, local);
    await store.refresh();
    expect(fetchTags).toHaveBeenCalledWith('http://10.0.0.5:11434', undefined);
    expect(store.catalog).toHaveLength(1);
    expect(store.online).toBe(true);
    expect(store.lastError).toBeUndefined();
    expect(reg.all.some(m => m.providerId === 'ollama' && m.providerModelId === 'llama3.1:8b')).toBe(true);
  });

  it('applyTags() leaves the registry untouched when a probe returns the same tags', () => {
    vi.useFakeTimers({ now: 1_000 });
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, makeLocalRuntime());
    let registryChanges = -1;
    const stop = autorun(() => { void reg.all; registryChanges += 1; });

    store.applyTags(TAGS_OK);
    expect(registryChanges).toBe(1);
    expect(store.lastRefreshAt).toBe(1_000);

    vi.setSystemTime(2_000);
    store.applyTags(structuredClone(TAGS_OK));
    expect(registryChanges).toBe(1);
    expect(store.lastRefreshAt).toBe(1_000);

    store.applyTags(STARTER_TAGS);
    expect(registryChanges).toBe(2);
    expect(store.catalog.map(model => model.id)).toEqual(['ollama-qwen3.5:4b']);
    expect(store.lastRefreshAt).toBe(2_000);
    stop();
  });

  it('refresh() reports an unreachable server in lastError', async () => {
    const local = makeLocalRuntime(async () => { throw new Error('ECONNREFUSED'); });
    const store = new OllamaStore(new ModelRegistry(), local);
    await store.refresh();
    expect(store.online).toBe(false);
    expect(store.lastError).toBe('Nothing is answering at http://127.0.0.1:11434.');
  });

  it('persists auth/catalog; new store rehydrates without a fetch', async () => {
    const local = makeLocalRuntime(async () => TAGS_OK);
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, local);
    await store.refresh();

    const local2 = makeLocalRuntime(async () => { throw new Error('should not be called'); });
    const reg2 = new ModelRegistry();
    const store2 = new OllamaStore(reg2, local2);
    expect(store2.catalog).toHaveLength(1);
    expect(reg2.all.some(m => m.providerId === 'ollama')).toBe(true);
  });

  it('setKey / setToolsEnabled mutate config', () => {
    const store = new OllamaStore(new ModelRegistry(), makeLocalRuntime());
    store.setKey('hunter2');
    expect(store.config.apiKey).toBe('hunter2');
    store.setKey('');
    expect(store.config.apiKey).toBeUndefined();
    store.setToolsEnabled(false);
    expect(store.config.toolsEnabled).toBe(false);
  });

  it('clearCatalog() empties the registry slice and storage', async () => {
    const local = makeLocalRuntime(async () => TAGS_OK);
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, local);
    await store.refresh();
    store.clearCatalog();
    expect(store.catalog).toEqual([]);
    expect(reg.all.some(m => m.providerId === 'ollama')).toBe(false);
  });

  it('startPull() enforces one active pull and duplicate guard', async () => {
    const local = makeLocalRuntime();
    runInAction(() => { local.runtimes.ollama.status = 'online'; });
    const store = new OllamaStore(new ModelRegistry(), local);
    vi.stubGlobal('fetch', vi.fn(async () => pendingPullResponse()));

    const first = store.startPull('qwen3.5:4b');
    await vi.waitFor(() => expect(store.isPulling('qwen3.5:4b')).toBe(true));

    await expect(store.startPull('qwen3.5:4b')).resolves.toBe(false);
    await expect(store.startPull('qwen2.5:7b')).resolves.toBe(false);
    expect(store.pulls.get('qwen2.5:7b')?.error).toMatch(/Finish or cancel qwen3\.5:4b/);

    store.cancelPull('qwen3.5:4b');
    await first;
  });

  it('startPull() refreshes the catalog after completion', async () => {
    const fetchTags = vi.fn<FetchTags>(async () => STARTER_TAGS);
    const local = makeLocalRuntime(fetchTags);
    runInAction(() => { local.runtimes.ollama.status = 'online'; });
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg, local);
    vi.stubGlobal('fetch', vi.fn(async () => pullResponse([{ status: 'success' }])));

    await expect(store.startPull('qwen3.5:4b')).resolves.toBe(true);

    expect(fetchTags).toHaveBeenCalled();
    expect(store.pulls.get('qwen3.5:4b')).toEqual({ percent: 100, phase: 'Installed' });
    expect(reg.all.some(model => model.providerId === 'ollama' && model.providerModelId === 'qwen3.5:4b')).toBe(true);
  });

  it('cancelPull() aborts the active pull', async () => {
    const local = makeLocalRuntime();
    runInAction(() => { local.runtimes.ollama.status = 'online'; });
    const store = new OllamaStore(new ModelRegistry(), local);
    vi.stubGlobal('fetch', vi.fn(async () => pendingPullResponse()));

    const promise = store.startPull('qwen3.5:4b');
    await vi.waitFor(() => expect(store.isPulling('qwen3.5:4b')).toBe(true));
    store.cancelPull('qwen3.5:4b');

    await expect(promise).resolves.toBe(false);
    expect(store.pulls.get('qwen3.5:4b')?.phase).toBe('Cancelled');
  });
});

function pullResponse(frames: unknown[]): Response {
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(enc.encode(`${JSON.stringify(frame)}\n`));
        controller.close();
      },
    }),
  } as unknown as Response;
}

function pendingPullResponse(): Response {
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`${JSON.stringify({ status: 'pulling layer', digest: 'a', total: 100, completed: 10 })}\n`));
        setTimeout(() => {
          controller.enqueue(enc.encode(`${JSON.stringify({ status: 'success' })}\n`));
          controller.close();
        }, 50);
      },
    }),
  } as unknown as Response;
}

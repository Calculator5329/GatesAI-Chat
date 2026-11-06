import { autorun, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaStore } from '../../src/stores/OllamaStore';
import { LocalRuntimeStore } from '../../src/stores/LocalRuntimeStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';
import { localModelContextProfile, type OllamaCatalogModel } from '../../src/core/localModelMeta';
import { contextWindowFor } from '../../src/core/tokens';
import { createEmptyThread } from '../../src/core/threadOps';
import { effectiveContextMode, wireMessagesForContextMode } from '../../src/services/chat/contextModes';
import { logger } from '../../src/services/diagnostics/logger';

/** Lets fire-and-forget /api/show lookups settle. */
async function flushLookups(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

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

  it('reads each model\'s loaded window from /api/show into contextLength, once per digest', async () => {
    const tags = {
      models: [
        { name: 'gemma4-abliterated:26b', digest: 'c18f9229521d', details: { context_length: 262_144 } },
        { name: 'gemma4:12b', digest: '4eb23ef187e2', details: { context_length: 262_144 } },
        { name: 'qwen2.5-coder:14b', digest: '9ec8897f747e', details: { context_length: 32_768 } },
      ],
    };
    const numCtxByTag: Record<string, number | undefined> = { 'gemma4-abliterated:26b': 16_384, 'qwen2.5-coder:14b': 8_192 };
    const fetchOllamaNumCtx = vi.fn(async (_baseUrl: string, tag: string) => numCtxByTag[tag]);
    const local = new LocalRuntimeStore({
      service: { fetchOllamaTags: async () => tags, fetchOllamaNumCtx },
      findComfy: async () => ({ baseUrl: 'http://127.0.0.1:8188', online: false, checkpoints: [], diffusionModels: [], preset: null }),
      subscribeToWake: () => () => {},
    });
    const store = new OllamaStore(new ModelRegistry(), local);
    const windowOf = (tag: string) => store.catalog.find(m => m.providerModelId === tag)?.contextLength;

    await store.refresh();
    await vi.waitFor(() => expect(windowOf('gemma4-abliterated:26b')).toBe(16_384));
    // No num_ctx in the Modelfile: left unset, so budgeting falls back to Ollama's own default.
    expect(windowOf('gemma4:12b')).toBeUndefined();
    // GatesAI sends num_ctx 32768 for the qwen2.5 profile, so that is the window it runs with.
    expect(windowOf('qwen2.5-coder:14b')).toBe(32_768);
    expect(fetchOllamaNumCtx.mock.calls.map(call => call[1])).toEqual(['gemma4-abliterated:26b', 'gemma4:12b']);

    await store.refresh();
    expect(windowOf('gemma4-abliterated:26b')).toBe(16_384);
    expect(fetchOllamaNumCtx).toHaveBeenCalledTimes(2);

    // A re-created tag (new digest) is looked up again.
    numCtxByTag['gemma4-abliterated:26b'] = 8_192;
    tags.models[0].digest = 'ffff00000000';
    await store.refresh();
    await vi.waitFor(() => expect(windowOf('gemma4-abliterated:26b')).toBe(8_192));
    expect(fetchOllamaNumCtx).toHaveBeenCalledTimes(3);
  });

  describe('observed window from /api/ps (review F4) and /api/show traffic (F6)', () => {
    const PLAIN_TAG = 'gemma4:12b';
    const CLOUD_TAG = 'gpt-oss:120b-cloud';
    const makeTags = () => ({
      models: [
        { name: PLAIN_TAG, digest: 'aaa111', details: { context_length: 262_144 } },
        { name: CLOUD_TAG, digest: 'ccc333', remote_model: 'gpt-oss:120b', remote_host: 'https://ollama.com:443', details: { context_length: 131_072 } },
      ],
    });
    const runningAt = (contextLength: number, digest = 'aaa111') => ({
      models: [{ name: PLAIN_TAG, model: PLAIN_TAG, digest, size_vram: 9e9, context_length: contextLength }],
    });

    function harness(state: { tags: ReturnType<typeof makeTags>; running: unknown; numCtx?: () => Promise<number | undefined> }) {
      const fetchOllamaNumCtx = vi.fn(async (_baseUrl: string, _tag: string) => (state.numCtx ? state.numCtx() : undefined));
      const fetchOllamaRunning = vi.fn(async () => state.running);
      const local = new LocalRuntimeStore({
        service: { fetchOllamaTags: async () => state.tags, fetchOllamaNumCtx, fetchOllamaRunning },
        findComfy: async () => ({ baseUrl: 'http://127.0.0.1:8188', online: false, checkpoints: [], diffusionModels: [], preset: null }),
        subscribeToWake: () => () => {},
      });
      const store = new OllamaStore(new ModelRegistry(), local);
      const model = (tag: string) => store.catalog.find(m => m.providerModelId === tag)!;
      return { store, local, model, fetchOllamaNumCtx, fetchOllamaRunning };
    }

    function threadWithHistory(modelId: string) {
      const thread = createEmptyThread('t-1', 1, modelId);
      thread.messages = [
        { id: 'u-1', role: 'user', content: 'Hi there.', createdAt: 1 },
        { id: 'a-1', role: 'assistant', content: 'Hello!', createdAt: 2 },
        { id: 'u-2', role: 'user', content: 'And then?', createdAt: 3 },
      ];
      return thread;
    }

    it('a plain tag with no num_ctx that /api/ps reports at 32768 runs full and sends history', async () => {
      const state = { tags: makeTags(), running: runningAt(32_768) };
      const { store, model } = harness(state);

      await store.refresh();
      await vi.waitFor(() => expect(model(PLAIN_TAG).contextLength).toBe(32_768));

      const plain = model(PLAIN_TAG);
      expect((plain as OllamaCatalogModel).observedContextLength).toBe(32_768);
      expect(localModelContextProfile(plain)).toBe('full');
      const thread = threadWithHistory(plain.id);
      expect(wireMessagesForContextMode(thread, effectiveContextMode(thread, plain))).toHaveLength(3);
    });

    // Fix round 3, finding 1: GatesAI sends no num_ctx for a plain tag, so
    // Ollama loads it at the Modelfile window whatever another client last
    // loaded it with. /api/ps only fills in when the Modelfile sets none.
    it('a Modelfile num_ctx of 16384 beats an /api/ps window of 65536 another client loaded: 16384, compact', async () => {
      const { store, model } = harness({ tags: makeTags(), running: runningAt(65_536), numCtx: async () => 16_384 });

      await store.refresh();
      await flushLookups();

      const plain = model(PLAIN_TAG);
      expect((plain as OllamaCatalogModel).observedContextLength).toBe(65_536);
      expect(plain.contextLength).toBe(16_384);
      expect(contextWindowFor(plain)).toBe(16_384);
      expect(localModelContextProfile(plain)).toBe('compact');
    });

    it('a Modelfile num_ctx of 16384 beats an /api/ps window of 2048 another client loaded', async () => {
      const { store, model } = harness({ tags: makeTags(), running: runningAt(2_048), numCtx: async () => 16_384 });

      await store.refresh();
      await flushLookups();

      expect(model(PLAIN_TAG).contextLength).toBe(16_384);
      expect(localModelContextProfile(model(PLAIN_TAG))).toBe('compact');
    });

    it('ignores an /api/ps entry whose digest does not match the listed tag (a stale runner of a re-created tag)', async () => {
      const { store, model } = harness({ tags: makeTags(), running: runningAt(32_768, 'zzz999') });

      await store.refresh();
      await flushLookups();

      expect((model(PLAIN_TAG) as OllamaCatalogModel).observedContextLength).toBeUndefined();
      expect(model(PLAIN_TAG).contextLength).toBeUndefined();
    });

    it('a base URL change drops the observed windows and the failed /api/show memory of the old host', async () => {
      const state = { tags: makeTags(), running: runningAt(32_768) as unknown };
      const { store, local, model, fetchOllamaNumCtx } = harness({
        ...state,
        numCtx: async () => { throw new Error('Ollama 500'); },
      });
      await store.refresh();
      await flushLookups();
      expect(model(PLAIN_TAG).contextLength).toBe(32_768);
      expect(fetchOllamaNumCtx).toHaveBeenCalledTimes(1);

      local.setBaseUrl('ollama', 'http://10.0.0.9:11434');

      // Host A's load says nothing about host B, even for the same digest.
      expect((model(PLAIN_TAG) as OllamaCatalogModel).observedContextLength).toBeUndefined();
      expect(model(PLAIN_TAG).contextLength).toBeUndefined();
      // The periodic probe of host B asks /api/show again.
      fetchOllamaNumCtx.mockImplementation(async () => 16_384);
      await local.probe('ollama');
      await flushLookups();
      expect(fetchOllamaNumCtx).toHaveBeenCalledTimes(2);
      expect(fetchOllamaNumCtx.mock.calls[1][0]).toBe('http://10.0.0.9:11434');
      expect(model(PLAIN_TAG).contextLength).toBe(16_384);
    });

    it('a failed /api/ps leaves the probe online and the window as it was', async () => {
      const { store, model, fetchOllamaRunning } = harness({ tags: makeTags(), running: { models: [] } });
      fetchOllamaRunning.mockRejectedValue(new Error('Ollama 404'));

      await store.refresh();

      expect(fetchOllamaRunning).toHaveBeenCalledTimes(1);
      expect(store.online).toBe(true);
      expect(model(PLAIN_TAG).contextLength).toBeUndefined();
    });

    it('with /api/ps silent a plain tag stays on the 4096 fallback, slim', async () => {
      const { store, model } = harness({ tags: makeTags(), running: { models: [] } });

      await store.refresh();
      await flushLookups();

      const plain = model(PLAIN_TAG);
      expect(plain.contextLength).toBeUndefined();
      expect(contextWindowFor(plain)).toBe(4_096);
      expect(localModelContextProfile(plain)).toBe('slim');
    });

    it('an Ollama cloud tag never gets the 4096 fallback: it uses the reported maximum and runs full', async () => {
      const { store, model, fetchOllamaNumCtx } = harness({ tags: makeTags(), running: { models: [] } });

      await store.refresh();
      await flushLookups();

      const cloud = model(CLOUD_TAG);
      expect(cloud.contextLength).toBe(131_072);
      expect(localModelContextProfile(cloud)).toBe('full');
      expect(fetchOllamaNumCtx.mock.calls.map(call => call[1])).not.toContain(CLOUD_TAG);
    });

    it('keeps the observed window after the model unloads, and drops it when the digest changes', async () => {
      const state = { tags: makeTags(), running: runningAt(32_768) as unknown };
      const { store, model } = harness(state);
      await store.refresh();
      await vi.waitFor(() => expect(model(PLAIN_TAG).contextLength).toBe(32_768));

      state.running = { models: [] };
      await store.refresh();
      await flushLookups();
      expect(model(PLAIN_TAG).contextLength).toBe(32_768);

      state.tags.models[0].digest = 'bbb222';
      await store.refresh();
      await flushLookups();
      expect(model(PLAIN_TAG).contextLength).toBeUndefined();
    });

    it('a model observed loaded runs full after a restart, without re-POSTing /api/show', async () => {
      const state = { tags: makeTags(), running: runningAt(32_768) as unknown };
      const first = harness(state);
      await first.store.refresh();
      await vi.waitFor(() => expect(first.model(PLAIN_TAG).contextLength).toBe(32_768));
      await flushLookups();
      expect(first.fetchOllamaNumCtx).toHaveBeenCalledTimes(1);
      first.store.dispose();

      state.running = { models: [] };
      const second = harness(state);
      expect(second.model(PLAIN_TAG).contextLength).toBe(32_768);
      await second.store.refresh();
      await flushLookups();
      expect(second.model(PLAIN_TAG).contextLength).toBe(32_768);
      expect(second.fetchOllamaNumCtx).not.toHaveBeenCalled();
    });

    it('remembers a failed /api/show for the session per tag and digest: one request and one warning, not one per probe', async () => {
      const warn = vi.spyOn(logger, 'warn');
      const { store, fetchOllamaNumCtx } = harness({
        tags: makeTags(),
        running: { models: [] },
        numCtx: async () => { throw new Error('Ollama 500'); },
      });

      for (let probe = 0; probe < 3; probe += 1) {
        await store.refresh();
        await flushLookups();
      }

      expect(fetchOllamaNumCtx).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.filter(call => String(call[1]).includes('/api/show'))).toHaveLength(1);
    });
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

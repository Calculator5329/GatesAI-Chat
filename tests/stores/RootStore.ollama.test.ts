import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { RootStore } from '../../src/stores/RootStore';
import { DEFAULT_MODEL_ID } from '../../src/core/models';
import { createEmptyThread } from '../../src/core/threadOps';
import type { Model } from '../../src/core/types';
import { clearAppStorage } from '../helpers/storage';

const QWEN: Model = {
  id: 'ollama-qwen3.5:4b',
  name: 'qwen3.5:4b',
  providerId: 'ollama',
  providerModelId: 'qwen3.5:4b',
  vendor: 'Ollama',
};

function bootWithOpenRouterKey(): RootStore {
  const root = new RootStore({ runtime: 'desktop' });
  vi.spyOn(root.localRuntime, 'startMonitoring').mockImplementation(() => {});
  root.providers.setKey('openrouter', 'openrouter-test-key');
  root.boot();
  return root;
}

/** Reassigns the Ollama registry slice with an equal catalog, re-running every registry observer. */
function probeAgain(root: RootStore): void {
  runInAction(() => root.registry.setDynamicForProvider('ollama', [{ ...QWEN }]));
}

// We use a fresh RootStore per test (it's normally a singleton, but the
// class itself is exported and re-instantiable). Storage is wiped in
// beforeEach so the store starts at defaults.
//
// RootStore boots BridgeStore.start() and SummaryStore.start() which can
// schedule background work (fetch polling, timers). We stub fetch to a
// harmless rejection so the bridge poll doesn't blow up against jsdom.
describe('RootStore — Ollama config bridge', () => {
  beforeEach(() => {
    clearAppStorage();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in test'); }));
  });
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); });

  it('overlays LocalRuntimeStore.ollamaBaseUrl into ProviderStore.effectiveConfigs.ollama', () => {
    const root = new RootStore();
    expect(root.providers.effectiveConfigs.ollama?.baseUrl).toBe(root.localRuntime.ollamaBaseUrl);
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBe(root.ollama.config.apiKey);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(root.ollama.config.toolsEnabled);
  });

  it('reflects setToolsEnabled toggles into effectiveConfigs.ollama', () => {
    const root = new RootStore();
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(true);
    root.ollama.setToolsEnabled(false);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(false);
    root.ollama.setToolsEnabled(true);
    expect(root.providers.effectiveConfigs.ollama?.toolsEnabled).toBe(true);
  });

  it('reflects local.setBaseUrl into effectiveConfigs.ollama.baseUrl', () => {
    const root = new RootStore();
    root.localRuntime.setBaseUrl('ollama', 'http://10.0.0.7:11434');
    expect(root.providers.effectiveConfigs.ollama?.baseUrl).toBe('http://10.0.0.7:11434');
  });

  it('hands tools the live Ollama key alongside the runtime URLs', () => {
    const root = new RootStore();
    const toolRuntime = () => root.chat['toolStoresProvider']?.().localRuntime;
    expect(toolRuntime()?.ollamaBaseUrl).toBe(root.localRuntime.ollamaBaseUrl);
    expect(toolRuntime()?.ollamaApiKey).toBeUndefined();

    root.ollama.setKey('test-ollama-key');
    expect(toolRuntime()?.ollamaApiKey).toBe('test-ollama-key');
  });

  it('reflects setKey changes', () => {
    const root = new RootStore();
    root.ollama.setKey('hunter2');
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBe('hunter2');
    root.ollama.setKey('');
    expect(root.providers.effectiveConfigs.ollama?.apiKey).toBeUndefined();
  });

  it('does not treat a cached Ollama catalog as locally available while runtime is offline', () => {
    const root = new RootStore();
    runInAction(() => {
      root.localRuntime.runtimes.ollama.status = 'offline';
      root.ollama.catalog = [{
        id: 'ollama-gpt-oss:20b',
        name: 'gpt-oss:20b',
        providerId: 'ollama',
        providerModelId: 'gpt-oss:20b',
        vendor: 'Ollama',
        contextWindow: 8000,
      }];
      root.registry.setDynamicForProvider('ollama', root.ollama.catalog);
    });

    expect(root.providers.effectiveConfigs.ollama?.available).toBe(false);
    expect(root.providers.isConnected('ollama')).toBe(false);
  });

  it('treats a cached Ollama catalog as locally available when runtime is online', () => {
    const root = new RootStore();
    runInAction(() => {
      root.localRuntime.runtimes.ollama.status = 'online';
      root.ollama.catalog = [{
        id: 'ollama-gpt-oss:20b',
        name: 'gpt-oss:20b',
        providerId: 'ollama',
        providerModelId: 'gpt-oss:20b',
        vendor: 'Ollama',
        contextWindow: 8000,
      }];
      root.registry.setDynamicForProvider('ollama', root.ollama.catalog);
    });

    expect(root.providers.effectiveConfigs.ollama?.available).toBe(true);
    expect(root.providers.isConnected('ollama')).toBe(true);
  });

  it('finds an Ollama that GatesAI did not start and loads its models on boot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'qwen3.5:4b', capabilities: ['completion', 'tools', 'vision', 'thinking'] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('no network in test');
    }));
    const root = new RootStore({ runtime: 'desktop' });

    root.boot();

    await vi.waitFor(() => expect(root.localRuntime.runtimes.ollama.status).toBe('online'));
    expect(root.ollama.catalog.map(model => model.id)).toEqual(['ollama-qwen3.5:4b']);
    expect(root.providers.isConnected('ollama')).toBe(true);
    root.dispose();
  });

  it('keeps first-run onboarding open when the only messages are the seeded welcome tour', () => {
    const root = new RootStore({ runtime: 'desktop' });
    expect(root.chat.threads.some(thread => thread.readOnly && thread.messages.length > 0)).toBe(true);

    root.boot();

    expect(root.ui.onboardingDismissed).toBe(false);
    root.dispose();
  });

  it('starts new chats on a local model by default once Ollama is online, even with an OpenRouter key', () => {
    const root = new RootStore();
    runInAction(() => {
      root.providers.setKey('openrouter', 'openrouter-test-key');
      root.localRuntime.runtimes.ollama.status = 'online';
      root.registry.setDynamicForProvider('ollama', [{
        id: 'ollama-qwen3.5:4b',
        name: 'qwen3.5:4b',
        providerId: 'ollama',
        providerModelId: 'qwen3.5:4b',
        vendor: 'Ollama',
        supportsTools: true,
      }]);
    });

    expect(root.localRuntime.preferLocalModels).toBe(true);
    expect(root.chat.defaultModelId).toBe('ollama-qwen3.5:4b');
    root.localRuntime.setPreferLocalModels(false);
    expect(root.chat.defaultModelId).not.toBe('ollama-qwen3.5:4b');
  });

  it('moves an untouched empty chat to the local default but never a chat with messages', () => {
    const root = new RootStore({ runtime: 'desktop' });
    vi.spyOn(root.localRuntime, 'startMonitoring').mockImplementation(() => {});
    root.providers.setKey('openrouter', 'openrouter-test-key');
    root.boot();
    const busyId = root.chat.createThread();
    runInAction(() => {
      const busy = root.chat.threads.find(thread => thread.id === busyId)!;
      busy.messages = [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }];
    });
    const emptyId = root.chat.createThread();
    const cloudDefault = root.chat.defaultModelId;

    runInAction(() => {
      root.registry.setDynamicForProvider('ollama', [{
        id: 'ollama-qwen3.5:4b',
        name: 'qwen3.5:4b',
        providerId: 'ollama',
        providerModelId: 'qwen3.5:4b',
        vendor: 'Ollama',
      }]);
      root.localRuntime.runtimes.ollama.status = 'online';
    });

    expect(root.chat.threads.find(thread => thread.id === busyId)?.modelId).toBe(cloudDefault);
    expect(root.chat.threads.find(thread => thread.id === emptyId)?.modelId).toBe('ollama-qwen3.5:4b');
    root.dispose();
  });

  it('moves only untouched empty chats when a local model first appears, never one the user picked', () => {
    const root = bootWithOpenRouterKey();
    const pickedId = root.chat.createThread();
    root.chat.setThreadModel(pickedId, DEFAULT_MODEL_ID);
    const untouchedId = root.chat.createThread();
    const modelOf = (id: string) => root.chat.threads.find(thread => thread.id === id)?.modelId;

    runInAction(() => {
      root.registry.setDynamicForProvider('ollama', [QWEN]);
      root.localRuntime.runtimes.ollama.status = 'online';
    });
    probeAgain(root);
    probeAgain(root);

    expect(modelOf(untouchedId)).toBe(QWEN.id);
    expect(modelOf(pickedId)).toBe(DEFAULT_MODEL_ID);
    root.dispose();
  });

  it('keeps a cloud pick on a new chat that started local through later probes', () => {
    const root = bootWithOpenRouterKey();
    runInAction(() => {
      root.registry.setDynamicForProvider('ollama', [QWEN]);
      root.localRuntime.runtimes.ollama.status = 'online';
    });
    const threadId = root.chat.createThread();
    const modelOf = () => root.chat.threads.find(thread => thread.id === threadId)?.modelId;
    expect(modelOf()).toBe(QWEN.id);

    root.chat.setThreadModel(threadId, DEFAULT_MODEL_ID);
    probeAgain(root);
    probeAgain(root);

    expect(modelOf()).toBe(DEFAULT_MODEL_ID);
    root.dispose();
  });

  it('moves an untouched empty chat that arrives in an import to the local default', () => {
    const root = bootWithOpenRouterKey();
    runInAction(() => {
      root.registry.setDynamicForProvider('ollama', [QWEN]);
      root.localRuntime.runtimes.ollama.status = 'online';
    });
    const imported = createEmptyThread('imported-empty', 1);

    root.chat.applyImportedSnapshot({ ...root.chat.snapshot, threads: [...root.chat.snapshot.threads, imported] });

    expect(root.chat.threads.find(thread => thread.id === imported.id)?.modelId).toBe(QWEN.id);
    root.dispose();
  });

  it('boots semantic memory as a no-op when Ollama is absent', () => {
    const root = new RootStore();

    expect(() => root.boot()).not.toThrow();
    expect(root.rag.active).toBe(false);
    expect(root.rag.status).toBe('ollama_offline');

    root.dispose();
  });
});

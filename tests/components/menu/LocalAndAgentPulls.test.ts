import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { LocalSection } from '../../../src/components/menu/sections/Local';
import { AgentSection } from '../../../src/components/menu/sections/Agent';
import { RootStore } from '../../../src/stores/RootStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { LocalRuntimeStore, type LocalRuntimeService } from '../../../src/stores/LocalRuntimeStore';
import { OllamaStore } from '../../../src/stores/OllamaStore';
import { ImageGenStore } from '../../../src/stores/ImageGenStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { OpenAiCompatEndpointStore } from '../../../src/stores/OpenAiCompatEndpointStore';
import type { RootStore as RootStoreType } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let currentStore: RootStoreType | null = null;

beforeEach(() => {
  clearAppStorage();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  currentStore?.dispose?.();
  currentStore = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearAppStorage();
});

function renderWithStore(store: RootStoreType, element: React.ReactElement): HTMLDivElement {
  currentStore = store;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, { store, children: element }));
  });
  return host;
}

function makeLocalStore(ollamaOnline: boolean): RootStoreType {
  const registry = new ModelRegistry();
  const service: LocalRuntimeService = {
    startRuntime: async () => {},
    stopRuntime: async () => {},
    getRuntimeStatus: async id => ({
      running: id === 'ollama' && ollamaOnline,
      status: id === 'ollama' && ollamaOnline ? 'online' : 'stopped',
      logs: [],
    }),
    probeHttp: async () => {},
    fetchOllamaTags: async () => ({ models: [] }),
    pathExists: async () => false,
    pickDirectory: async () => null,
    pickFile: async () => null,
    getCandidatePaths: async () => null,
  };
  const local = new LocalRuntimeStore({ service, autoDetect: async () => ({}) });
  const ollama = new OllamaStore(registry, local);
  const providers = new ProviderStore(registry, undefined, { autoPersist: false });
  runInAction(() => {
    local.runtimes.ollama.status = ollamaOnline ? 'online' : 'stopped';
  });
  return {
    registry,
    providers,
    openAiCompatEndpoint: new OpenAiCompatEndpointStore(registry, providers),
    localRuntime: local,
    ollama,
    imageGen: new ImageGenStore(),
    bridge: {
      openWorkspacePath: async () => {},
      openExternalTarget: async () => {},
    },
  } as unknown as RootStoreType;
}

describe('LocalSection recommended Ollama pulls', () => {
  it('shows the custom OpenAI-compatible endpoint card on desktop', () => {
    const store = makeLocalStore(false);
    const rendered = renderWithStore(store, createElement(LocalSection));

    expect(rendered.textContent).toContain('Custom endpoint (OpenAI-compatible)');
    expect(rendered.textContent).toContain('LM Studio 1234');
  });

  it('shows the custom OpenAI-compatible endpoint card in Web Lite', () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const store = makeLocalStore(false);
    const rendered = renderWithStore(store, createElement(LocalSection));

    expect(rendered.textContent).toContain('Web Lite');
    expect(rendered.textContent).toContain('Custom endpoint (OpenAI-compatible)');
    expect(rendered.textContent).not.toContain('Recommended models');
  });

  it('shows recommended models and gates pulls while Ollama is offline', () => {
    const store = makeLocalStore(false);
    const rendered = renderWithStore(store, createElement(LocalSection));

    expect(rendered.textContent).toContain('Recommended models');
    expect(rendered.textContent).toContain('Qwen 2.5 7B');
    expect(rendered.textContent).toContain('Nomic Embed Text');
    expect(rendered.textContent).toContain('Start Ollama first.');
    const pullButtons = Array.from(rendered.querySelectorAll('button')).filter(button => button.textContent === 'Pull');
    expect(pullButtons.some(button => button.disabled)).toBe(true);
  });

  it('shows installed state with delete affordance', () => {
    const store = makeLocalStore(true);
    runInAction(() => {
      store.ollama.tagNames = ['llama3.2:3b'];
    });
    const deleteSpy = vi.spyOn(store.ollama, 'deleteModel').mockResolvedValue(true);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const rendered = renderWithStore(store, createElement(LocalSection));

    expect(rendered.textContent).toContain('Installed');
    const deleteButton = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Delete') as HTMLButtonElement | undefined;
    act(() => deleteButton?.click());

    expect(deleteSpy).toHaveBeenCalledWith('llama3.2:3b');
  });

  it('shows pulling progress and cancel', () => {
    const store = makeLocalStore(true);
    runInAction(() => {
      store.ollama.pulls.set('qwen2.5:7b', { percent: 42, phase: 'pulling layer' });
    });
    vi.spyOn(store.ollama, 'isPulling').mockImplementation(model => model === 'qwen2.5:7b');
    const cancelSpy = vi.spyOn(store.ollama, 'cancelPull');
    const rendered = renderWithStore(store, createElement(LocalSection));

    expect(rendered.textContent).toContain('pulling layer · 42%');
    const cancel = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Cancel') as HTMLButtonElement | undefined;
    act(() => cancel?.click());

    expect(cancelSpy).toHaveBeenCalledWith('qwen2.5:7b');
  });

  it('renders auto-detect not-found guidance as neutral instead of alert red', () => {
    const store = makeLocalStore(false);
    runInAction(() => {
      store.localRuntime.runtimes.ollama.lastError = 'Auto-detect could not find ollama.exe - use Browse to point at it.';
      store.localRuntime.runtimes.ollama.lastErrorKind = 'not-found';
    });
    const rendered = renderWithStore(store, createElement(LocalSection));

    const neutral = rendered.querySelector('.local-runtime-message--not-found') as HTMLElement | null;
    expect(neutral?.textContent).toContain('Auto-detect could not find ollama.exe');
    expect(neutral?.getAttribute('role')).toBe('status');
    expect(rendered.querySelector('.local-runtime-message--error')).toBeNull();
    expect(rendered.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders start failures as error alerts', () => {
    const store = makeLocalStore(false);
    runInAction(() => {
      store.localRuntime.runtimes.ollama.lastError = 'spawn failed';
      store.localRuntime.runtimes.ollama.lastErrorKind = 'error';
    });
    const rendered = renderWithStore(store, createElement(LocalSection));

    const alert = rendered.querySelector('.local-runtime-message--error') as HTMLElement | null;
    expect(alert?.textContent).toContain('spawn failed');
    expect(alert?.getAttribute('role')).toBe('alert');
  });
});

describe('AgentSection semantic memory pull', () => {
  it('uses a Pull now button when Ollama is online and embedding model is missing', () => {
    const store = new RootStore();
    runInAction(() => {
      store.localRuntime.runtimes.ollama.status = 'online';
      store.ollama.tagNames = [];
    });
    const pull = vi.spyOn(store.ollama, 'startPull').mockResolvedValue(true);
    const rendered = renderWithStore(store, createElement(AgentSection));

    expect(rendered.textContent).toContain('Semantic memory');
    expect(rendered.textContent).toContain('ollama pull nomic-embed-text');
    const button = Array.from(rendered.querySelectorAll('button'))
      .find(item => item.textContent === 'Pull now') as HTMLButtonElement | undefined;
    act(() => button?.click());

    expect(pull).toHaveBeenCalledWith('nomic-embed-text');
  });
});

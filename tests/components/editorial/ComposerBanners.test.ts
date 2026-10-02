import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { ChatStore } from '../../../src/stores/ChatStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { RouterStore } from '../../../src/stores/RouterStore';
import { LocalRuntimeStore } from '../../../src/stores/LocalRuntimeStore';
import { OllamaStore } from '../../../src/stores/OllamaStore';
import { LocalModelMissingBanner, OllamaOfflineBanner } from '../../../src/components/editorial/composer/ComposerBanners';
import type { RootStore } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GEMMA = { id: 'ollama-gemma4:12b', name: 'gemma4:12b', vendor: 'Ollama', providerId: 'ollama' as const, providerModelId: 'gemma4:12b' };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let chat: ChatStore | null = null;
let router: RouterStore | null = null;

beforeEach(() => clearAppStorage());

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  chat?.dispose();
  chat = null;
  router?.destroy();
  router = null;
  clearAppStorage();
});

describe('LocalModelMissingBanner', () => {
  it('names the local model the current Ollama lacks and opens Models settings', () => {
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    chat = new ChatStore(providers, registry, new UserProfileStore());
    router = new RouterStore();
    const localRuntime = new LocalRuntimeStore({ probesEnabled: false });
    const store = { chat, registry, providers, router, localRuntime } as RootStore;
    runInAction(() => {
      chat!.activeThread!.modelId = GEMMA.id;
      chat!.activeThread!.messages.push({ id: 'u1', role: 'user', content: 'hi', createdAt: 1 });
    });
    const goMenu = vi.spyOn(router, 'goMenu');

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(StoreProvider, { store, children: createElement(LocalModelMissingBanner) })));

    expect(host.textContent).toContain('gemma4:12b is not on the Ollama at http://127.0.0.1:11434.');
    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="workspace.composer-banners.open-models-for-missing-local-model"]')!.click();
    });
    expect(goMenu).toHaveBeenCalledWith('models');

    act(() => registry.setDynamicForProvider('ollama', [GEMMA]));
    expect(host.textContent).toBe('');
  });
});

describe('OllamaOfflineBanner', () => {
  it('checks Ollama again on demand instead of waiting out the backoff', () => {
    const registry = new ModelRegistry();
    const localRuntime = new LocalRuntimeStore({ probesEnabled: false });
    const ollama = new OllamaStore(registry, localRuntime, { useKeychainSecrets: false });
    router = new RouterStore();
    const store = { registry, router, localRuntime, ollama } as RootStore;
    runInAction(() => { localRuntime.runtimes.ollama.status = 'offline'; });
    const probe = vi.spyOn(localRuntime, 'probe');

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(StoreProvider, { store, children: createElement(OllamaOfflineBanner) })));
    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="workspace.composer-banners.recheck-ollama"]')!.click();
    });

    expect(probe).toHaveBeenCalledWith('ollama', { fresh: true });
  });
});

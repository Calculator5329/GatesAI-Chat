import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { ChatStore } from '../../../src/stores/ChatStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { UiStore } from '../../../src/stores/UiStore';
import { RouterStore } from '../../../src/stores/RouterStore';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { ExecStreamStore } from '../../../src/stores/ExecStreamStore';
import { LocalRuntimeStore } from '../../../src/stores/LocalRuntimeStore';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import { OpenRouterStore } from '../../../src/stores/OpenRouterStore';
import { OllamaStore } from '../../../src/stores/OllamaStore';
import { SkillsStore } from '../../../src/stores/SkillsStore';
import { EditorialChat } from '../../../src/components/editorial/EditorialChat';
import { flushPendingSnapshot } from '../../../src/services/persistence';
import type { RootStore } from '../../../src/stores/RootStore';
import type { Message } from '../../../src/core/types';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderTracker = vi.hoisted(() => ({
  counts: new Map<string, number>(),
}));

vi.mock('../../../src/components/editorial/EditorialComposer', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    EditorialComposer: () => React.createElement('div', { 'data-testid': 'composer' }),
  };
});

vi.mock('../../../src/components/editorial/EditorialMessage', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    EditorialMessage: ({ message }: { message: Message }) => {
      renderTracker.counts.set(message.id, (renderTracker.counts.get(message.id) ?? 0) + 1);
      return React.createElement('article', { 'data-message-id': message.id }, message.content);
    },
  };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let store: RootStore | null = null;

function buildStore(): RootStore {
  const registry = new ModelRegistry();
  const profile = new UserProfileStore();
  const ui = new UiStore();
  const router = new RouterStore();
  const bridge = new BridgeStore();
  const execStream = new ExecStreamStore();
  const localRuntime = new LocalRuntimeStore({ autoDetect: async () => ({}) });
  const ollama = new OllamaStore(registry, localRuntime);
  const providers = new ProviderStore(registry, () => ({
    ollama: {
      baseUrl: localRuntime.ollamaBaseUrl,
      apiKey: ollama.config.apiKey,
      available: localRuntime.runtimes.ollama.status === 'online',
      toolsEnabled: ollama.config.toolsEnabled,
    },
  }));
  const openrouter = new OpenRouterStore(registry, () => providers.getConfig('openrouter').apiKey);
  const chat = new ChatStore(providers, registry, profile);
  const imageJobs = new ImageJobStore();
  const skills = new SkillsStore(bridge, () => ['thread']);
  return {
    registry,
    providers,
    profile,
    chat,
    ui,
    router,
    bridge,
    execStream,
    localRuntime,
    openrouter,
    ollama,
    imageJobs,
    skills,
  } as RootStore;
}

function seedMessages(chat: ChatStore, count: number): Message[] {
  const active = chat.activeThread;
  if (!active) throw new Error('missing active thread');
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    createdAt: index,
    ...(index % 2 === 1 ? { model: 'or-gpt-5.4-mini' } : {}),
  })) as Message[];
  runInAction(() => {
    active.messages = messages;
  });
  return messages;
}

function renderChat(s: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: s,
        children: createElement(EditorialChat),
      }),
    );
  });
  return host;
}

beforeEach(() => {
  clearAppStorage();
  renderTracker.counts.clear();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  store?.router.destroy();
  // dispose() drains the 250ms autosave throttle synchronously, so no timer
  // can write to localStorage after clearAppStorage() (previously a 260ms sleep).
  store?.chat.dispose();
  store?.ui.dispose();
  store?.ollama.dispose();
  store?.providers.dispose();
  store = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  flushPendingSnapshot();
  clearAppStorage();
});

describe('EditorialChat empty state (Batch C)', () => {
  it('renders onboarding paths when no provider and no prior messages are configured', () => {
    store = buildStore();
    const rendered = renderChat(store);

    expect(rendered.textContent).toContain('GatesAI Chat');
    expect(rendered.textContent).toContain('Local-first AI workspace');
    expect(rendered.textContent).toContain('Chat with frontier models');
    expect(rendered.textContent).toContain('Use cloud models');
    expect(rendered.textContent).toContain('Use local models');
    expect(rendered.textContent).toContain('Just look around');
    expect(rendered.textContent).toContain('OpenRouter requires a key');
    expect(rendered.textContent).not.toContain('Connect OpenRouter in Models');
  });

  it('hides onboarding once a provider key is ready', () => {
    store = buildStore();
    store.providers.setKey('openrouter', 'sk-test');
    const rendered = renderChat(store);

    expect(rendered.textContent).toContain('A blank thread is ready; write below when you want to begin.');
    expect(rendered.textContent).not.toContain('Use cloud models');
    expect(rendered.textContent).not.toContain('Connect OpenRouter in Models');
  });

  it('stores a valid OpenRouter key through ProviderStore and hides onboarding', async () => {
    store = buildStore();
    const setKey = vi.spyOn(store.providers, 'setKey');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{
          id: 'google/gemini-3-flash',
          name: 'Gemini 3 Flash',
          architecture: { output_modalities: ['text'] },
        }],
      }),
    })));
    const rendered = renderChat(store);
    const input = rendered.querySelector('input[placeholder="Paste your OpenRouter API key..."]') as HTMLInputElement;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => ' sk-or-good ' },
    });

    await act(async () => {
      input.dispatchEvent(event);
      await vi.waitFor(() => expect(store!.providers.getConfig('openrouter').apiKey).toBe('sk-or-good'));
    });

    expect(setKey).toHaveBeenCalledWith('openrouter', 'sk-or-good');
    expect(store.ui.onboardingDismissed).toBe(true);
    expect(rendered.textContent).not.toContain('Use cloud models');
    expect(rendered.textContent).toContain('Key works - 1 model available.');
  });

  it('selects an online Ollama model and dismisses onboarding', () => {
    store = buildStore();
    store.registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3',
      name: 'Llama 3 Local',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3',
    }]);
    runInAction(() => {
      store!.localRuntime.runtimes.ollama.status = 'online';
    });
    const rendered = renderChat(store);
    const useLocal = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Use Llama 3 Local')) as HTMLButtonElement | undefined;

    act(() => useLocal?.click());

    expect(store.chat.activeThread?.modelId).toBe('ollama-llama3');
    expect(store.ui.onboardingDismissed).toBe(true);
    expect(rendered.textContent).not.toContain('Use cloud models');
    expect(rendered.textContent).toContain('Ollama detected - 1 model ready.');
  });

  it('look around dismisses onboarding and persists the preference', () => {
    store = buildStore();
    const rendered = renderChat(store);
    const lookAround = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Look around') as HTMLButtonElement | undefined;

    act(() => lookAround?.click());
    store.ui.dispose();

    expect(store.ui.onboardingDismissed).toBe(true);
    expect(rendered.textContent).not.toContain('Use cloud models');
    expect(JSON.parse(localStorage.getItem('gatesai.uiprefs.v1') ?? '{}').onboardingDismissed).toBe(true);
  });

  it('hides the local path in Web Lite onboarding', () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    store = buildStore();
    const rendered = renderChat(store);

    expect(rendered.textContent).toContain('Use cloud models');
    expect(rendered.textContent).not.toContain('Use local models');
  });

  it('does not render onboarding when any prior thread has messages', () => {
    store = buildStore();
    seedMessages(store.chat, 1);
    store.chat.createThread();
    const rendered = renderChat(store);

    expect(rendered.textContent).not.toContain('Use cloud models');
    expect(store.ui.onboardingDismissed).toBe(true);
  });
});

describe('EditorialChat long histories', () => {
  it('renders newest messages first and pages older history on demand', () => {
    store = buildStore();
    store.chat.createThread();
    seedMessages(store.chat, 250);

    const rendered = renderChat(store);

    expect(rendered.querySelectorAll('[data-message-id]').length).toBe(120);
    expect(rendered.querySelector('[data-message-id="m-130"]')).not.toBeNull();
    expect(rendered.querySelector('[data-message-id="m-249"]')).not.toBeNull();
    expect(rendered.querySelector('[data-message-id="m-129"]')).toBeNull();

    const showEarlier = rendered.querySelector('.editorial-show-earlier') as HTMLButtonElement | null;
    expect(showEarlier?.textContent).toContain('Show 80 earlier messages');

    act(() => showEarlier?.click());

    expect(rendered.querySelectorAll('[data-message-id]').length).toBe(200);
    expect(rendered.querySelector('[data-message-id="m-50"]')).not.toBeNull();
    expect(rendered.querySelector('[data-message-id="m-49"]')).toBeNull();
  });

  it('does not rerender the visible message list for streaming token scroll updates', () => {
    store = buildStore();
    store.chat.createThread();
    const messages = seedMessages(store.chat, 130);
    const streaming = messages[messages.length - 1];

    act(() => {
      runInAction(() => {
        store!.chat.streamingByThread[store!.chat.activeThreadId!] = streaming.id;
      });
    });
    renderChat(store);
    const countsAfterRender = new Map(renderTracker.counts);

    act(() => {
      runInAction(() => {
        streaming.content += ' token';
      });
    });

    for (const [messageId, count] of countsAfterRender) {
      expect(renderTracker.counts.get(messageId)).toBe(count);
    }
  });
});

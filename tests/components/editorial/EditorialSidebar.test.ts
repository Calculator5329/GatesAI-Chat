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
import { EditorialSidebar } from '../../../src/components/editorial/EditorialSidebar';
import { flushPendingSnapshot } from '../../../src/services/persistence';
import type { RootStore } from '../../../src/stores/RootStore';
import type { Thread } from '../../../src/core/types';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let store: RootStore | null = null;

function buildStore(): RootStore {
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const chat = new ChatStore(providers, registry, profile);
  const ui = new UiStore();
  const router = new RouterStore();
  const bridge = new BridgeStore();
  const execStream = new ExecStreamStore();
  const localRuntime = new LocalRuntimeStore({ autoDetect: async () => ({}) });
  const imageJobs = new ImageJobStore();
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
    imageJobs,
  } as RootStore;
}

function seedThreads(chat: ChatStore, count: number): void {
  const threads = Array.from({ length: count }, (_, index) => ({
    id: `thread-${index}`,
    title: `Alpha ${index}`,
    subtitle: `needle ${index}`,
    createdAt: index,
    updatedAt: index,
    pinned: false,
    modelId: 'or-gpt-5.4-mini',
    messages: [],
  })) as Thread[];
  runInAction(() => {
    chat.threads = threads;
    chat.activeThreadId = threads[0]?.id ?? null;
  });
}

function renderSidebar(s: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: s,
        children: createElement(EditorialSidebar),
      }),
    );
  });
  return host;
}

beforeEach(() => {
  clearAppStorage();
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
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
  store = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  flushPendingSnapshot();
  clearAppStorage();
});

describe('EditorialSidebar history list', () => {
  it('caps the unpinned history at 20 rows while still showing pinned threads', () => {
    store = buildStore();
    seedThreads(store.chat, 150);

    const rendered = renderSidebar(store);
    expect(rendered.querySelector('input[type="search"]')).toBeNull();
    expect(rendered.querySelectorAll('.editorial-sidebar__item').length).toBe(20);
  });

  it('keeps Begin a new conversation as a new-thread button', () => {
    store = buildStore();
    seedThreads(store.chat, 1);
    const originalThreadId = store.chat.activeThreadId;

    const rendered = renderSidebar(store);
    const newConversation = rendered.querySelector<HTMLButtonElement>(
      'button.editorial-sidebar__new[aria-label="Begin a new conversation"]',
    );
    expect(newConversation).not.toBeNull();
    expect(rendered.querySelector('input[type="search"]')).toBeNull();

    act(() => {
      newConversation!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      newConversation!.focus();
    });

    expect(rendered.querySelector('input[type="search"]')).toBeNull();
    expect(newConversation).toBe(document.activeElement);

    act(() => {
      newConversation!.click();
    });

    expect(store.chat.activeThreadId).not.toBe(originalThreadId);
    expect(store.chat.activeThread?.title).toBe('New conversation');
    expect(rendered.querySelector('input[type="search"]')).toBeNull();
  });
});

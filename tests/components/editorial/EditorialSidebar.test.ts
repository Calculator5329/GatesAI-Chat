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

afterEach(async () => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  store?.router.destroy();
  store = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await new Promise(resolve => setTimeout(resolve, 260));
  flushPendingSnapshot();
  clearAppStorage();
});

describe('EditorialSidebar search', () => {
  it('debounces search and caps rendered matches while preserving the default 20-row history', () => {
    store = buildStore();
    seedThreads(store.chat, 150);

    const rendered = renderSidebar(store);
    expect(rendered.querySelectorAll('.editorial-sidebar__item').length).toBe(20);

    const input = rendered.querySelector('input[type="search"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing search input');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'alpha');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rendered.querySelectorAll('.editorial-sidebar__item').length).toBe(20);

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(rendered.querySelectorAll('.editorial-sidebar__item').length).toBe(100);
  });
});

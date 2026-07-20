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
import { SkillsStore } from '../../../src/stores/SkillsStore';
import { EditorialSidebar } from '../../../src/components/editorial/EditorialSidebar';
import { EditorialChat } from '../../../src/components/editorial/EditorialChat';
import { flushPendingSnapshot, loadSnapshot } from '../../../src/services/persistence';
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
  const skills = new SkillsStore(bridge, () => ['thread']);
  // W-5's UpdatePill reads updates.visible from the sidebar; a hidden stub
  // keeps these presentation tests focused on the history list.
  const updates = { visible: false } as RootStore['updates'];
  const search = { braveReady: false } as RootStore['search'];
  const dock = { available: false, openPanel: () => {} } as unknown as RootStore['dock'];

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
    skills,
    updates,
    search,
    dock,
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

function renderSidebarWithChat(s: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: s,
        children: createElement('div', {
          style: { display: 'flex', height: 800 },
        }, createElement(EditorialSidebar), createElement(EditorialChat)),
      }),
    );
  });
  return host;
}

beforeEach(() => {
  clearAppStorage();
  vi.useFakeTimers();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
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

  it('renders agent task threads in their own group above the dated history', () => {
    store = buildStore();
    const now = Date.now();
    const threads = [
      {
        id: 'agent-1',
        title: 'Agent: Audit',
        subtitle: '',
        createdAt: now - 1000,
        updatedAt: now,
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        messages: [],
        agentTask: true,
        agentTaskOriginThreadId: 'thread-1',
        agentTaskStatus: 'done',
      },
      {
        id: 'thread-1',
        title: 'Conversation',
        subtitle: '',
        createdAt: now - 1000,
        updatedAt: now,
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        messages: [],
      },
    ] as Thread[];
    runInAction(() => {
      store!.chat.threads = threads;
      store!.chat.activeThreadId = 'thread-1';
    });

    const rendered = renderSidebar(store);
    const text = rendered.textContent ?? '';
    expect(text.indexOf('Agent tasks')).toBeGreaterThanOrEqual(0);
    // The lone conversation was touched just now, so it lands under "Today",
    // which renders below the agent-task group.
    expect(text.indexOf('Agent tasks')).toBeLessThan(text.indexOf('Today'));
    expect(rendered.querySelectorAll('.editorial-sidebar__item')).toHaveLength(2);
  });

  it('splits unpinned history under date headers by updatedAt', () => {
    store = buildStore();
    const now = Date.now();
    const current = new Date(now);
    const todayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
    const mondayDate = current.getDate() - ((current.getDay() + 6) % 7);
    const threads = [
      { id: 'today-1', updatedAt: now },
      { id: 'yesterday-1', updatedAt: todayStart - 1 },
      { id: 'week-1', updatedAt: new Date(current.getFullYear(), current.getMonth(), mondayDate).getTime() },
      { id: 'month-1', updatedAt: new Date(current.getFullYear(), current.getMonth(), 1).getTime() },
    ].map(seed => ({
      id: seed.id,
      title: seed.id,
      subtitle: '',
      createdAt: seed.updatedAt,
      updatedAt: seed.updatedAt,
      pinned: false,
      modelId: 'or-gpt-5.4-mini',
      messages: [],
    })) as Thread[];
    runInAction(() => {
      store!.chat.threads = threads;
      store!.chat.activeThreadId = 'today-1';
    });

    const rendered = renderSidebar(store);
    const text = rendered.textContent ?? '';
    const today = text.indexOf('Today');
    const yesterday = text.indexOf('Yesterday');
    const week = text.indexOf('Previous 7 days');
    const month = text.indexOf('Previous 30 days');
    expect(today).toBeGreaterThanOrEqual(0);
    expect(yesterday).toBeGreaterThan(today);
    expect(week).toBeGreaterThan(yesterday);
    expect(month).toBeGreaterThan(week);
    expect(rendered.querySelectorAll('.editorial-sidebar__item')).toHaveLength(4);
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

  it('renames a thread from the hover action and persists the edited title', () => {
    store = buildStore();
    seedThreads(store.chat, 1);
    const threadId = store.chat.activeThreadId!;
    const rendered = renderSidebar(store);
    const renameButton = rendered.querySelector<HTMLButtonElement>(
      'button.editorial-sidebar__rename-button',
    );

    expect(renameButton?.getAttribute('aria-label')).toBe('Rename "Alpha 0"');
    act(() => renameButton!.click());

    const input = rendered.querySelector<HTMLInputElement>(
      'input.editorial-sidebar__rename-input',
    );
    expect(input).toBe(document.activeElement);
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'Quarterly planning');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    flushPendingSnapshot();

    expect(store.chat.threads.find(thread => thread.id === threadId)?.title).toBe('Quarterly planning');
    expect(rendered.querySelector('input.editorial-sidebar__rename-input')).toBeNull();
    expect(loadSnapshot()?.threads.find(thread => thread.id === threadId)?.title).toBe('Quarterly planning');
  });

  it('opens rename on right-click and cancels it with Escape', () => {
    store = buildStore();
    seedThreads(store.chat, 1);
    const rendered = renderSidebar(store);
    const row = rendered.querySelector<HTMLElement>('.editorial-sidebar__item')!;

    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const input = rendered.querySelector<HTMLInputElement>('input.editorial-sidebar__rename-input')!;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'Discarded title');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(store.chat.activeThread?.title).toBe('Alpha 0');
    expect(rendered.querySelector('input.editorial-sidebar__rename-input')).toBeNull();
  });

  it('keeps the new-conversation button clickable with a message action bar in the chat pane', () => {
    store = buildStore();
    const originalThreadId = store.chat.activeThreadId!;
    runInAction(() => {
      store!.chat.activeThread!.messages.push(
        { id: 'u1', role: 'user', content: 'Question', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'Answer', createdAt: 2, model: 'or-gemini-3-flash' },
      );
    });

    const rendered = renderSidebarWithChat(store);
    expect(rendered.querySelector('[aria-label="Regenerate response"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Branch conversation"]')).not.toBeNull();

    const newConversation = rendered.querySelector<HTMLButtonElement>(
      'button[aria-label="Begin a new conversation"]',
    );
    expect(newConversation).not.toBeNull();

    act(() => {
      newConversation!.click();
    });

    expect(store.chat.activeThreadId).not.toBe(originalThreadId);
    expect(store.chat.activeThread?.messages).toEqual([]);
    expect(store.chat.visibleThreads).toHaveLength(2);
  });
});

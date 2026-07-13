import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopAmbient } from '../../src/app/useDesktopAmbient';
import {
  DESKTOP_KNOWLEDGE_DOM_EVENT,
  DESKTOP_KNOWLEDGE_SHORTCUT_STATE_DOM_EVENT,
  DESKTOP_NEW_CONVERSATION_DOM_EVENT,
  DESKTOP_SUMMON_DOM_EVENT,
} from '../../src/services/desktop/ambient';
import type { RootStore } from '../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockUi {
  globalSummonEnabled = true;
  globalSummonChord = 'Ctrl+Shift+Space';
  closeButtonHidesToTray = false;
  focusComposer = vi.fn();
  setGlobalShortcutStatus = vi.fn();
  markMenuHintSeen = vi.fn();
}

class MockRouter {
  isMenu = true;
  goThread = vi.fn(() => { this.isMenu = false; });
  goMenu = vi.fn(() => { this.isMenu = true; });
}

function offlineLibrary(phase: 'healthy' | 'disabled' = 'disabled') {
  return {
    enabled: phase === 'healthy',
    phase,
    profileForTask: vi.fn((task: string) => task === 'public_database_schema'
      ? { model: 'qwen2.5-coder:14b' }
      : null),
    setKnowledgeShortcutStatus: vi.fn(),
  };
}

function AmbientHarness({ store }: { store: RootStore }) {
  useDesktopAmbient(store);
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderHarness(store: RootStore): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AmbientHarness, { store })));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('useDesktopAmbient', () => {
  it('focuses the composer on summon events', () => {
    const ui = new MockUi();
    const router = new MockRouter();
    const store = {
      ui,
      router,
      chat: { activeThreadId: 'thread-1', createThread: vi.fn() },
      registry: { all: [] },
      offlineLibrary: offlineLibrary(),
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_SUMMON_DOM_EVENT)));

    expect(router.goThread).toHaveBeenCalledWith('thread-1');
    expect(ui.focusComposer).toHaveBeenCalled();
  });

  it('creates and opens a thread on tray new conversation events', () => {
    const ui = new MockUi();
    const router = new MockRouter();
    const createThread = vi.fn(() => 'thread-new');
    const store = {
      ui,
      router,
      chat: { activeThreadId: 'thread-1', createThread },
      registry: { all: [] },
      offlineLibrary: offlineLibrary(),
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_NEW_CONVERSATION_DOM_EVENT)));

    expect(createThread).toHaveBeenCalled();
    expect(router.goThread).toHaveBeenCalledWith('thread-new');
    expect(ui.focusComposer).toHaveBeenCalled();
  });

  it('opens Super+G as a fresh fully local knowledge chat', () => {
    const ui = new MockUi();
    const router = new MockRouter();
    const chat = {
      activeThreadId: 'thread-1',
      createThread: vi.fn(() => 'knowledge-thread'),
      renameThread: vi.fn(),
      setThreadModel: vi.fn(),
      setThreadContext: vi.fn(),
    };
    const store = {
      ui,
      router,
      chat,
      offlineLibrary: offlineLibrary('healthy'),
      registry: { all: [{ id: 'ollama-qwen', providerId: 'ollama', providerModelId: 'qwen2.5-coder:14b', supportsTools: true }] },
      providers: { isConnected: () => true },
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_KNOWLEDGE_DOM_EVENT)));

    expect(chat.createThread).toHaveBeenCalled();
    expect(chat.renameThread).toHaveBeenCalledWith('knowledge-thread', 'Offline knowledge');
    expect(chat.setThreadModel).toHaveBeenCalledWith('knowledge-thread', 'ollama-qwen');
    expect(chat.setThreadContext).toHaveBeenCalledWith('knowledge-thread', expect.stringContaining('never request rows'));
    expect(router.goThread).toHaveBeenCalledWith('knowledge-thread');
    expect(ui.focusComposer).toHaveBeenCalled();
  });

  it('routes Super+G visibly to setup instead of falling back remotely', () => {
    const ui = new MockUi();
    const router = new MockRouter();
    const createThread = vi.fn();
    const store = {
      ui,
      router,
      chat: { activeThreadId: 'thread-1', createThread },
      registry: { all: [{ id: 'cloud', providerId: 'openrouter', providerModelId: 'cloud' }] },
      offlineLibrary: offlineLibrary(),
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_KNOWLEDGE_DOM_EVENT)));

    expect(router.goMenu).toHaveBeenCalledWith('settings');
    expect(createThread).not.toHaveBeenCalled();
  });

  it('routes a healthy addon to Local when no tool-capable Ollama model exists', () => {
    const ui = new MockUi();
    const router = new MockRouter();
    const createThread = vi.fn();
    const store = {
      ui,
      router,
      chat: { activeThreadId: 'thread-1', createThread },
      registry: { all: [{ id: 'cloud', providerId: 'openrouter', providerModelId: 'cloud' }] },
      offlineLibrary: offlineLibrary('healthy'),
      providers: { isConnected: () => true },
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_KNOWLEDGE_DOM_EVENT)));

    expect(router.goMenu).toHaveBeenCalledWith('local');
    expect(createThread).not.toHaveBeenCalled();
  });

  it('records fixed shortcut availability from the desktop shell', () => {
    const ui = new MockUi();
    const library = offlineLibrary();
    const store = {
      ui,
      router: new MockRouter(),
      chat: { activeThreadId: 'thread-1', createThread: vi.fn() },
      registry: { all: [] },
      offlineLibrary: library,
    } as unknown as RootStore;
    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_KNOWLEDGE_SHORTCUT_STATE_DOM_EVENT, {
      detail: { enabled: true, chord: 'Super+G', available: true, reason: null },
    })));
    expect(library.setKnowledgeShortcutStatus).toHaveBeenCalledWith(true, null);
  });
});

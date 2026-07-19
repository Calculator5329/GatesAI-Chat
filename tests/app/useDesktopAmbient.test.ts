import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopAmbient } from '../../src/app/useDesktopAmbient';
import {
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
    } as unknown as RootStore;

    renderHarness(store);
    act(() => window.dispatchEvent(new CustomEvent(DESKTOP_NEW_CONVERSATION_DOM_EVENT)));

    expect(createThread).toHaveBeenCalled();
    expect(router.goThread).toHaveBeenCalledWith('thread-new');
    expect(ui.focusComposer).toHaveBeenCalled();
  });
});

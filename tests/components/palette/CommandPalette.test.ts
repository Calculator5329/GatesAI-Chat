import { Fragment, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
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
import { CommandPalette } from '../../../src/components/palette/CommandPalette';
import { flushPendingSnapshot } from '../../../src/services/persistence';
import type { RootStore } from '../../../src/stores/RootStore';
import type { Thread } from '../../../src/core/types';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let store: RootStore | null = null;

const PaletteShell = observer(function PaletteShell() {
  return createElement(
    Fragment,
    null,
    createElement(EditorialSidebar),
    store?.ui.paletteOpen ? createElement(CommandPalette) : null,
  );
});

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

function seedThreads(chat: ChatStore): void {
  const threads = [
    thread('thread-alpha', 'Alpha launch notes', 'roadmap'),
    thread('thread-beta', 'Invoice follow-up', 'workspace billing notes'),
    thread('thread-gamma', 'Deleted archive', 'hidden', Date.now()),
  ];
  runInAction(() => {
    chat.threads = threads;
    chat.activeThreadId = threads[0].id;
  });
}

function thread(id: string, title: string, subtitle: string, deletedAt?: number): Thread {
  return {
    id,
    title,
    subtitle,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-gpt-5.4-mini',
    messages: [],
    ...(deletedAt == null ? {} : { deletedAt }),
  };
}

function renderPaletteShell(s: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: s,
        children: createElement(PaletteShell),
      }),
    );
  });
  return host;
}

function setPaletteQuery(rendered: HTMLElement, value: string): void {
  const input = rendered.querySelector<HTMLInputElement>('input[aria-label="Search commands and threads"]');
  if (!input) throw new Error('missing command palette input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  clearAppStorage();
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
  store?.chat.dispose();
  store?.ui.dispose();
  store = null;
  vi.restoreAllMocks();
  flushPendingSnapshot();
  clearAppStorage();
});

describe('CommandPalette', () => {
  it('opens from UiStore state and filters visible threads', () => {
    store = buildStore();
    seedThreads(store.chat);
    const rendered = renderPaletteShell(store);

    expect(rendered.querySelector('[data-testid="command-palette-backdrop"]')).toBeNull();

    act(() => store!.ui.openPalette());

    let palette = rendered.querySelector('[data-testid="command-palette-backdrop"]');
    expect(palette).not.toBeNull();
    expect(palette?.textContent).toContain('Alpha launch notes');
    expect(palette?.textContent).toContain('Invoice follow-up');
    expect(palette?.textContent).not.toContain('Deleted archive');

    setPaletteQuery(rendered, 'invoice');

    palette = rendered.querySelector('[data-testid="command-palette-backdrop"]');
    expect(palette?.textContent).toContain('Invoice follow-up');
    expect(palette?.textContent).not.toContain('Alpha launch notes');
  });

  it('runs the selected thread on Enter and closes', () => {
    store = buildStore();
    seedThreads(store.chat);
    const rendered = renderPaletteShell(store);

    act(() => store!.ui.openPalette());
    setPaletteQuery(rendered, 'invoice');

    const input = rendered.querySelector<HTMLInputElement>('input[aria-label="Search commands and threads"]');
    act(() => {
      input!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(store.router.threadId).toBe('thread-beta');
    expect(store.chat.activeThreadId).toBe('thread-beta');
    expect(store.ui.paletteOpen).toBe(false);
    expect(rendered.querySelector('[data-testid="command-palette-backdrop"]')).toBeNull();
  });

  it('unmounts the backdrop after close and leaves the sidebar new button clickable', () => {
    store = buildStore();
    seedThreads(store.chat);
    const rendered = renderPaletteShell(store);
    const originalCount = store.chat.visibleThreads.length;

    act(() => store!.ui.openPalette());

    const backdrop = rendered.querySelector<HTMLElement>('[data-testid="command-palette-backdrop"]');
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(store.ui.paletteOpen).toBe(false);
    expect(rendered.querySelector('[data-testid="command-palette-backdrop"]')).toBeNull();

    const newConversation = rendered.querySelector<HTMLButtonElement>(
      'button.editorial-sidebar__new[aria-label="Begin a new conversation"]',
    );
    expect(newConversation).not.toBeNull();

    act(() => {
      newConversation!.click();
    });

    expect(store.chat.visibleThreads.length).toBe(originalCount + 1);
    expect(store.chat.activeThread?.title).toBe('New conversation');
  });
});

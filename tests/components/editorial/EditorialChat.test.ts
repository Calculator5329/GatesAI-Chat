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

afterEach(async () => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  store?.router.destroy();
  store = null;
  vi.restoreAllMocks();
  await new Promise(resolve => setTimeout(resolve, 260));
  flushPendingSnapshot();
  clearAppStorage();
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

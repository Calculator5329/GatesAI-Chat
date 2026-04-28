import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { ChatStore } from '../../../src/stores/ChatStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { UiStore } from '../../../src/stores/UiStore';
import { RouterStore } from '../../../src/stores/RouterStore';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { ExecStreamStore } from '../../../src/stores/ExecStreamStore';
import { EditorialComposer } from '../../../src/components/editorial/EditorialComposer';
import type { RootStore } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';
import { flush } from '../../helpers/mockProvider';

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
  return {
    registry,
    providers,
    profile,
    chat,
    ui,
    router,
    bridge,
    execStream,
  } as RootStore;
}

function render(s: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const textareaRef = createRef<HTMLTextAreaElement>();
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: s,
        children: createElement(EditorialComposer, {
          sendKey: 'ghost',
          textareaRef,
        }),
      }),
    );
  });
  return host;
}

beforeEach(() => {
  clearAppStorage();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  store?.router.destroy();
  store = null;
  clearAppStorage();
});

describe('EditorialComposer API-key banner', () => {
  it('shows the API-key banner and disables send when no provider is configured', () => {
    store = buildStore();
    const rendered = render(store);

    expect(rendered.textContent).toContain('Add an API key to start chatting.');

    // Send button is the last visual control inside the composer row. The
    // wrapper div has cursor + opacity inline styles tied to canSend.
    // With text in the draft but no provider, opacity should be 0.45.
    act(() => store!.ui.setDraft('hello'));
    const sendWrapper = Array.from(rendered.querySelectorAll('div'))
      .find(d => (d as HTMLElement).getAttribute('title') === 'Send') as HTMLElement | undefined;
    expect(sendWrapper).toBeDefined();
    expect(sendWrapper!.style.opacity).toBe('0.45');
    expect(sendWrapper!.style.cursor).toBe('default');
  });

  it('hides the banner once a provider key is set (live transition)', async () => {
    // Mount with NO provider configured — banner should be visible and send
    // disabled. Then mutate the store to add a real key and assert the UI
    // re-renders. This proves the MobX observer subscribed to a dep that
    // actually fires on configs mutation (the `void this.configs;` touch in
    // ProviderStore.hasUsableProvider). Without that touch, the observer
    // would never re-render and the post-setKey assertions would fail.
    store = buildStore();
    const rendered = render(store);
    act(() => store!.ui.setDraft('hello'));

    // Pre-condition: banner present, send disabled.
    expect(rendered.textContent).toContain('Add an API key to start chatting.');
    let sendWrapper = Array.from(rendered.querySelectorAll('div'))
      .find(d => (d as HTMLElement).getAttribute('title') === 'Send') as HTMLElement | undefined;
    expect(sendWrapper).toBeDefined();
    expect(sendWrapper!.style.opacity).toBe('0.45');
    expect(sendWrapper!.style.cursor).toBe('default');

    // Live transition: add a key after mount.
    act(() => store!.providers.setKey('openai', 'sk-test'));
    await flush(2);

    // Post-condition: banner gone, send enabled.
    expect(rendered.textContent).not.toContain('Add an API key to start chatting.');
    sendWrapper = Array.from(rendered.querySelectorAll('div'))
      .find(d => (d as HTMLElement).getAttribute('title') === 'Send') as HTMLElement | undefined;
    expect(sendWrapper).toBeDefined();
    expect(sendWrapper!.style.opacity).toBe('1');
    expect(sendWrapper!.style.cursor).toBe('pointer');
  });

  it('allows sending in direct-image mode without an LLM provider key', () => {
    store = buildStore();
    const threadId = store.chat.activeThreadId!;
    store.chat.setThreadModel(threadId, 'image-direct-comfy');
    const rendered = render(store);

    act(() => store!.ui.setDraft('a neon greenhouse at night'));

    expect(rendered.textContent).not.toContain('Add an API key to start chatting.');
    const sendWrapper = Array.from(rendered.querySelectorAll('div'))
      .find(d => (d as HTMLElement).getAttribute('title') === 'Send') as HTMLElement | undefined;
    expect(sendWrapper).toBeDefined();
    expect(sendWrapper!.style.opacity).toBe('1');
    expect(sendWrapper!.style.cursor).toBe('pointer');
  });
});

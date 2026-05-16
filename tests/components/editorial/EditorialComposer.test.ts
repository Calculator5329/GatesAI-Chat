import { act, createElement, createRef } from 'react';
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
          textareaRef,
        }),
      }),
    );
  });
  return host;
}

function sendControl(rendered: HTMLElement, title = 'Send'): HTMLButtonElement {
  const button = rendered.querySelector(`button.composer-send-control[title="${title}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`Missing composer send control: ${title}`);
  return button;
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
    const sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(true);
    expect(sendWrapper.style.opacity).toBe('0.45');
    expect(sendWrapper.style.cursor).toBe('default');
  });

  it('hides the banner once a provider key is set (live transition)', async () => {
    // Mount with NO provider configured ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â banner should be visible and send
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
    let sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(true);
    expect(sendWrapper.style.opacity).toBe('0.45');
    expect(sendWrapper.style.cursor).toBe('default');

    // Live transition: add a key after mount.
    act(() => store!.providers.setKey('openrouter', 'sk-test'));
    await flush(2);

    // Post-condition: banner gone, send enabled.
    expect(rendered.textContent).not.toContain('Add an API key to start chatting.');
    sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(false);
    expect(sendWrapper.style.opacity).toBe('1');
    expect(sendWrapper.style.cursor).toBe('pointer');
  });

  it('exposes send, interrupt, and stop as real buttons', () => {
    store = buildStore();
    store.providers.setKey('openrouter', 'sk-test');
    const rendered = render(store);

    act(() => store!.ui.setDraft('hello'));
    let control = sendControl(rendered);
    expect(control.getAttribute('aria-label')).toBe('Send');
    expect(control.disabled).toBe(false);

    act(() => {
      runInAction(() => {
        (store!.chat as unknown as { streamingByThread: Record<string, string> }).streamingByThread[store!.chat.activeThreadId!] = 'a-stream';
      });
    });
    control = sendControl(rendered, 'Interrupt and send');
    expect(control.getAttribute('aria-label')).toBe('Interrupt and send');
    expect(control.disabled).toBe(false);

    act(() => store!.ui.setDraft(''));
    control = sendControl(rendered, 'Stop');
    expect(control.getAttribute('aria-label')).toBe('Stop');
    expect(control.disabled).toBe(false);
  });

  it('falls back to Gemini 3 Flash when the active thread has no resolvable model', async () => {
    store = buildStore();
    store.chat.setThreadModel(store.chat.activeThreadId!, 'missing-model');
    store.providers.setKey('openrouter', 'sk-test');
    await flush(2);

    const rendered = render(store);
    act(() => store!.ui.setDraft('hello'));

    expect(rendered.textContent).toContain('Gemini 3 Flash');
    expect(rendered.textContent).not.toContain('Select model');
    expect(rendered.textContent).not.toContain('Add an API key to start chatting.');
    const sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(false);
    expect(sendWrapper.style.opacity).toBe('1');
    expect(sendWrapper.style.cursor).toBe('pointer');
  });

  it('disables direct-image mode until ComfyUI is ready', () => {
    store = buildStore();
    const threadId = store.chat.activeThreadId!;
    store.chat.setThreadModel(threadId, 'image-direct-comfy');
    const rendered = render(store);

    act(() => store!.ui.setDraft('a neon greenhouse at night'));

    expect(rendered.textContent).toContain('Start and connect ComfyUI');
    const sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(true);
    expect(sendWrapper.style.opacity).toBe('0.45');
    expect(sendWrapper.style.cursor).toBe('default');
  });

  it('allows sending in direct-image mode once ComfyUI is ready', () => {
    store = buildStore();
    const threadId = store.chat.activeThreadId!;
    store.chat.setThreadModel(threadId, 'image-direct-comfy');
    runInAction(() => {
      store!.localRuntime.runtimes.comfyui.status = 'online';
    });
    const rendered = render(store);

    act(() => store!.ui.setDraft('a neon greenhouse at night'));

    expect(rendered.textContent).not.toContain('Add an API key to start chatting.');
    expect(rendered.textContent).not.toContain('Start and connect ComfyUI');
    const sendWrapper = sendControl(rendered);
    expect(sendWrapper.disabled).toBe(false);
    expect(sendWrapper.style.opacity).toBe('1');
    expect(sendWrapper.style.cursor).toBe('pointer');
  });

  it('does not show the gray estimated-send cost', () => {
    store = buildStore();
    store.providers.setKey('openrouter', 'sk-test');
    const rendered = render(store);

    expect(rendered.textContent).not.toMatch(/~\$/);
    expect(rendered.querySelector('[title="Estimated cost if sent now"]')).toBeNull();
  });

  it('keeps the green spent amount when the chat has recorded spend', () => {
    store = buildStore();
    store.providers.setKey('openrouter', 'sk-test');
    runInAction(() => {
      store!.chat.activeThread!.messages.push({
        id: 'a-cost',
        role: 'assistant',
        content: 'done',
        createdAt: Date.now(),
        usage: [{
          providerId: 'openrouter',
          modelId: 'google/gemini-3-flash-preview',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costUsd: 0.0042,
        }],
      });
    });
    const rendered = render(store);

    expect(rendered.textContent).toContain('$0.004');
    expect(rendered.textContent).not.toContain('spent $0.004');
    expect(rendered.textContent).not.toMatch(/~\$/);
  });

  it('does not show API source guidance in the composer footer', () => {
    store = buildStore();
    store.providers.setKey('openrouter', 'sk-test');
    const rendered = render(store);

    expect(rendered.textContent).not.toContain('auto · Gemini 3 Flash API');
  });

  it('keeps the local context selector without footer source guidance', () => {
    store = buildStore();
    store.registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3',
      name: 'Llama 3 Local',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3',
      contextLength: 8000,
    }]);
    store.chat.setThreadModel(store.chat.activeThreadId!, 'ollama-llama3');
    runInAction(() => {
      store!.localRuntime.runtimes.ollama.status = 'online';
    });

    const rendered = render(store);
    expect((rendered.querySelector('select') as HTMLSelectElement | null)?.value).toBe('micro');
    expect(rendered.textContent).not.toContain('local Ã‚· micro tools');
  });

  it('model picker auto row selects Gemini 3 Flash API', () => {
    store = buildStore();
    store.registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3',
      name: 'Llama 3 Local',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3',
    }]);
    store.chat.setThreadModel(store.chat.activeThreadId!, 'ollama-llama3');
    const rendered = render(store);

    act(() => {
      rendered.querySelector('.composer-model-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(rendered.textContent).toContain('Auto: Gemini 3 Flash API');
    act(() => {
      rendered.querySelector('[data-model-row="auto-gemini-3-flash"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(store.chat.activeThread?.modelId).toBe('or-gemini-3-flash');
  });

  it('model picker source filters show local rows and Ollama readiness badges', () => {
    store = buildStore();
    store.registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3',
      name: 'Llama 3 Local',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3',
      supportsTools: false,
    }]);
    const rendered = render(store);

    act(() => {
      rendered.querySelector('.composer-model-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      rendered.querySelector('[data-source-filter="local"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(rendered.textContent).toContain('Llama 3 Local');
    expect(rendered.textContent).toContain('LOCAL');
    expect(rendered.textContent).toContain('offline');
    expect(rendered.textContent).toContain('tools off');
    expect(rendered.textContent).not.toContain('Auto: Gemini 3 Flash API');
  });

  it('model picker keeps recent selections without changing the active model until picked', () => {
    store = buildStore();
    const rendered = render(store);

    act(() => {
      rendered.querySelector('.composer-model-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      rendered.querySelector('[data-source-filter="cloud"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      rendered.querySelector('[data-model-row="or-gpt-5.5"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(store.chat.activeThread?.modelId).toBe('or-gpt-5.5');

    act(() => {
      store!.chat.setThreadModel(store!.chat.activeThreadId!, 'or-gemini-3-flash');
    });
    act(() => {
      rendered.querySelector('.composer-model-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(rendered.textContent).toContain('Recent');
    expect(rendered.textContent).toContain('GPT-5.5');
    expect(store.chat.activeThread?.modelId).toBe('or-gemini-3-flash');
  });

  it('uploads pasted clipboard images as attachments', async () => {
    store = buildStore();
    runInAction(() => {
      store!.bridge.state = 'online';
    });
    const upload = vi.fn(async (file: File) => ({
      id: 'att-paste',
      filename: file.name,
      path: `/workspace/attachments/${file.name}`,
      size: file.size,
      mime: file.type,
    }));
    store.bridge.uploadAttachment = upload;
    const rendered = render(store);
    const textarea = rendered.querySelector('textarea')!;
    const image = new File(['pixels'], '', { type: 'image/png' });
    const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => image },
          { kind: 'file', type: 'text/plain', getAsFile: () => text },
        ],
      },
    });

    await act(async () => {
      textarea.dispatchEvent(event);
      await flush(5);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    const pasted = upload.mock.calls[0][0] as File;
    expect(pasted.name).toMatch(/^pasted-image-\d{8}-\d{6}\.png$/);
    expect(store.ui.attachments[0]).toMatchObject({
      filename: pasted.name,
      mime: 'image/png',
    });
  });
});

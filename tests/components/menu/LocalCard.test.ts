import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalCard } from '../../../src/components/menu/sections/api/LocalCard';
import { StoreProvider } from '../../../src/stores/context';
import { LocalRuntimeStore } from '../../../src/stores/LocalRuntimeStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { OllamaStore } from '../../../src/stores/OllamaStore';
import type { RootStore } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let localRuntime: LocalRuntimeStore | undefined;

beforeEach(() => clearAppStorage());
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  localRuntime?.dispose();
  vi.unstubAllGlobals();
  clearAppStorage();
});

describe('LocalCard address hints', () => {
  it.each([
    ['connection refused', 'http://gpu-box', new TypeError('Connection refused'), 'http://gpu-box:11434'],
    ['404', 'http://gpu-box', 404, 'http://gpu-box:11434'],
    ['https 401', 'https://gpu-box', 401, '(HTTP 401). Check the Ollama API key in Settings > Models.'],
    ['https 403', 'https://gpu-box', 403, '(HTTP 403). Check the Ollama API key in Settings > Models.'],
    ['TLS mismatch', 'https://gpu-box:11434', new TypeError('received corrupt message of type InvalidContentType'), 'http://gpu-box:11434'],
  ])('renders the probe message for %s', async (_case, address, failure, suggested) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure instanceof Error) throw failure;
      return new Response('', { status: failure });
    }));
    const registry = new ModelRegistry();
    localRuntime = new LocalRuntimeStore({ probesEnabled: true });
    const ollama = new OllamaStore(registry, localRuntime, { useKeychainSecrets: false });
    const store = { registry, localRuntime, ollama } as RootStore;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(StoreProvider, { store, children: createElement(LocalCard) })));

    await act(async () => {
      localRuntime!.setBaseUrl('ollama', address);
      await localRuntime!.probe('ollama');
    });

    expect(host.querySelector('[data-testid="settings.models.local-card"]')?.textContent).toContain(suggested);
    expect(host.textContent).toContain(localRuntime.runtimes.ollama.lastError);
  });
});

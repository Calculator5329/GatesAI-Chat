import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { LocalRuntimeStore } from '../../../src/stores/LocalRuntimeStore';
import { ModelPopover } from '../../../src/components/editorial/ModelPopover';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import type { RootStore } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

interface Harness {
  store: RootStore;
  registry: ModelRegistry;
  localRuntime: LocalRuntimeStore;
}

function buildHarness(): Harness {
  const registry = new ModelRegistry();
  const localRuntime = new LocalRuntimeStore({ autoDetect: async () => ({}) });
  const store = {
    registry,
    localRuntime,
    providers: { getConfig: () => ({}) },
    chat: { defaultModelId: DEFAULT_MODEL_ID },
    skills: { skills: [] },
  } as unknown as RootStore;
  return { store, registry, localRuntime };
}

function addOllama(registry: ModelRegistry): void {
  registry.setDynamicForProvider('ollama', [{
    id: 'ollama-llama3',
    name: 'Llama 3 Local',
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId: 'llama3',
  }]);
}

function render(h: Harness, opts: { currentModelId?: string; onPick?: (id: string) => void } = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: h.store,
        children: createElement(ModelPopover, {
          currentModelId: opts.currentModelId ?? DEFAULT_MODEL_ID,
          onPick: opts.onPick ?? (() => {}),
          onClose: () => {},
        }),
      }),
    );
  });
  return host;
}

function click(rendered: HTMLElement, selector: string): void {
  act(() => {
    rendered.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  clearAppStorage();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllEnvs();
  clearAppStorage();
});

describe('ModelPopover verified prominence', () => {
  it('renders a prominent Verified section with the curated catalog', () => {
    const h = buildHarness();
    const rendered = render(h);
    expect(rendered.textContent).toContain('Verified');
    expect(rendered.querySelector('[data-model-row="or-gpt-5.5"]')).toBeTruthy();
    expect(rendered.querySelector('[data-model-row="or-claude-opus-latest"]')).toBeTruthy();
  });
});

describe('ModelPopover runtime gating', () => {
  it('shows only auto and cloud tabs in web-lite, hiding local and image', () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const h = buildHarness();
    addOllama(h.registry);
    runInAction(() => {
      h.localRuntime.runtimes.ollama.status = 'online';
      h.localRuntime.runtimes.comfyui.status = 'online';
    });
    const rendered = render(h);
    expect(rendered.querySelector('[data-source-filter="auto"]')).toBeTruthy();
    expect(rendered.querySelector('[data-source-filter="cloud"]')).toBeTruthy();
    expect(rendered.querySelector('[data-source-filter="local"]')).toBeNull();
    expect(rendered.querySelector('[data-source-filter="image"]')).toBeNull();
    expect(rendered.querySelector('[data-model-row="ollama-llama3"]')).toBeNull();
    expect(rendered.querySelector('[data-model-row="image-direct-comfy"]')).toBeNull();
  });

  it('keeps an empty local tab while Ollama is offline on desktop', () => {
    const h = buildHarness();
    addOllama(h.registry);
    const rendered = render(h);
    expect(rendered.querySelector('[data-source-filter="local"]')).toBeTruthy();
    click(rendered, '[data-source-filter="local"]');
    expect(rendered.querySelector('[data-model-row="ollama-llama3"]')).toBeNull();
    expect(rendered.textContent).toContain('Start Ollama in Local settings');
  });

  it('shows the local tab and ollama rows once Ollama is online', () => {
    const h = buildHarness();
    addOllama(h.registry);
    runInAction(() => { h.localRuntime.runtimes.ollama.status = 'online'; });
    const rendered = render(h);
    expect(rendered.querySelector('[data-source-filter="local"]')).toBeTruthy();
    click(rendered, '[data-source-filter="local"]');
    expect(rendered.querySelector('[data-model-row="ollama-llama3"]')).toBeTruthy();
    expect(rendered.textContent).toContain('online');
  });

  it('hides image models until ComfyUI is ready, then lets them be picked', () => {
    const h = buildHarness();
    const rendered = render(h);
    expect(rendered.querySelector('[data-source-filter="image"]')).toBeNull();
    expect(rendered.querySelector('[data-model-row="image-direct-comfy"]')).toBeNull();

    act(() => root?.unmount());
    root = null;
    host?.remove();

    runInAction(() => { h.localRuntime.runtimes.comfyui.status = 'online'; });
    const picked: string[] = [];
    const rendered2 = render(h, { onPick: id => picked.push(id) });
    expect(rendered2.querySelector('[data-source-filter="image"]')).toBeTruthy();
    click(rendered2, '[data-source-filter="image"]');
    const row = rendered2.querySelector('[data-model-row="image-direct-comfy"]');
    expect(row).toBeTruthy();
    click(rendered2, '[data-model-row="image-direct-comfy"]');
    expect(picked).toContain('image-direct-comfy');
  });
});

describe('ModelPopover capability filters', () => {
  it('filters to free models when the free chip is active', () => {
    const h = buildHarness();
    const rendered = render(h);
    click(rendered, '[data-source-filter="cloud"]');
    click(rendered, '[data-cap-filter="free"]');
    expect(rendered.querySelector('[data-model-row="or-nemotron-3-ultra-free"]')).toBeTruthy();
    expect(rendered.querySelector('[data-model-row="or-gpt-5.5-pro"]')).toBeNull();
    expect(rendered.querySelector('[data-model-row="auto-gemini-3-flash"]')).toBeNull();
  });
});

describe('ModelPopover search', () => {
  it('finds cloud models by name while on the auto tab', () => {
    const h = buildHarness();
    const rendered = render(h);
    const input = rendered.querySelector('input') as HTMLInputElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'kimi');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rendered.querySelector('[data-model-row="or-kimi-k2.6"]')).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageGenStore } from '../../src/stores/ImageGenStore';
import type { LocalRuntimeStore } from '../../src/stores/LocalRuntimeStore';
import { clearAppStorage } from '../helpers/storage';

function fakeLocalRuntime(comfyStatus: 'online' | 'stopped' = 'stopped'): LocalRuntimeStore {
  return {
    comfyBaseUrl: 'http://127.0.0.1:8188',
    runtimes: {
      comfyui: { status: comfyStatus },
      ollama: { status: 'stopped' },
    },
  } as unknown as LocalRuntimeStore;
}

describe('ImageGenStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('defaults to an OpenRouter image backend snapshot using the shared OpenRouter key', () => {
    const store = new ImageGenStore(undefined, () => 'sk-or-test');

    expect(store.toBackendConfig().primary).toBe('openrouter-image');
    expect(store.toBackendConfig().openRouterApiKey).toBe('sk-or-test');
  });

  it('passes the ComfyUI upscale factor through the backend snapshot', () => {
    const store = new ImageGenStore();

    expect(store.toBackendConfig().comfyUpscaleFactor).toBe(1);

    store.setComfyUpscaleFactor(2);

    expect(store.toBackendConfig().comfyUpscaleFactor).toBe(2);
  });

  it('falls back to OpenRouter when ComfyUI is selected but not online', () => {
    const store = new ImageGenStore(fakeLocalRuntime('stopped'), () => 'sk-or-test');
    store.setBackend('local-comfy');

    expect(store.backend).toBe('local-comfy');
    expect(store.effectiveBackend).toBe('openrouter-image');
    expect(store.toBackendConfig().primary).toBe('openrouter-image');
  });

  it('falls back to ComfyUI when OpenRouter has no key but ComfyUI is online', () => {
    const store = new ImageGenStore(fakeLocalRuntime('online'), () => undefined);
    store.setBackend('openrouter-image');

    expect(store.backend).toBe('openrouter-image');
    expect(store.effectiveBackend).toBe('local-comfy');
    expect(store.toBackendConfig().primary).toBe('local-comfy');
  });
});

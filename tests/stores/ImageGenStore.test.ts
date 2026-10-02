import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageGenStore, type ImageGenLocalRuntime } from '../../src/stores/ImageGenStore';
import type { ComfyDiscovery } from '../../src/services/image/comfyDiscovery';
import { clearAppStorage } from '../helpers/storage';

/** ComfyUI Desktop found on its own port with SDXL Lightning installed. */
const DESKTOP_COMFY: ComfyDiscovery = {
  baseUrl: 'http://127.0.0.1:8000',
  online: true,
  checkpoints: ['sdxl_lightning_4step.safetensors'],
  diffusionModels: [],
  preset: { kind: 'sdxl-lightning' },
};

function fakeLocalRuntime(comfy: 'ready' | 'offline' = 'offline'): ImageGenLocalRuntime {
  return {
    comfyBaseUrl: 'http://127.0.0.1:8188',
    comfyReady: comfy === 'ready',
    comfyDiscovery: comfy === 'ready' ? DESKTOP_COMFY : null,
  };
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

  it('passes configurable study-backed sampling defaults through the backend snapshot', () => {
    const store = new ImageGenStore();
    expect(store.toBackendConfig()).toMatchObject({
      comfyQualitySteps: 12,
      comfyDraftSteps: 8,
      comfyCfg: 1,
    });

    store.setComfyQualitySteps(16);
    store.setComfyDraftSteps(7);
    store.setComfyCfg(1.5);
    expect(store.toBackendConfig()).toMatchObject({
      comfyQualitySteps: 16,
      comfyDraftSteps: 7,
      comfyCfg: 1.5,
    });
  });

  it('uses a ready ComfyUI by default even when an OpenRouter key exists', () => {
    const store = new ImageGenStore(fakeLocalRuntime('ready'), () => 'sk-or-test');

    expect(store.backendChoice).toBe('auto');
    expect(store.backend).toBe('local-comfy');
    expect(store.toBackendConfig()).toMatchObject({
      primary: 'local-comfy',
      comfyBaseUrl: 'http://127.0.0.1:8000',
      comfyDiscovery: DESKTOP_COMFY,
    });
  });

  it('uses OpenRouter by default while ComfyUI is not ready', () => {
    const store = new ImageGenStore(fakeLocalRuntime('offline'), () => 'sk-or-test');

    expect(store.backend).toBe('openrouter-image');
    expect(store.toBackendConfig().comfyBaseUrl).toBe('http://127.0.0.1:8188');
  });

  it('sends requests to a running ComfyUI without a model when there is no OpenRouter key, so its error explains the fix', () => {
    const noModel: ImageGenLocalRuntime = {
      comfyBaseUrl: 'http://127.0.0.1:8188',
      comfyReady: false,
      comfyDiscovery: { ...DESKTOP_COMFY, checkpoints: [], preset: null },
    };

    expect(new ImageGenStore(noModel, () => undefined).backend).toBe('local-comfy');
    expect(new ImageGenStore(noModel, () => 'sk-or-test').backend).toBe('openrouter-image');
  });

  it('uses a running ComfyUI with a saved custom workflow even when no built-in workflow fits its models', () => {
    const customOnly: ImageGenLocalRuntime = {
      comfyBaseUrl: 'http://127.0.0.1:8188',
      comfyReady: false,
      comfyDiscovery: { ...DESKTOP_COMFY, checkpoints: ['flux1-dev-fp8.safetensors'], preset: null },
    };
    new ImageGenStore(customOnly, () => 'sk-or-test').setComfyWorkflowPath('workflows/flux-dev.json');

    const reopened = new ImageGenStore(customOnly, () => 'sk-or-test');

    expect(reopened.backendChoice).toBe('auto');
    expect(reopened.backend).toBe('local-comfy');
    expect(new ImageGenStore(fakeLocalRuntime('offline'), () => 'sk-or-test').backend).toBe('openrouter-image');
  });

  it('keeps an explicit OpenRouter pick when ComfyUI is ready, across restarts', () => {
    const first = new ImageGenStore(fakeLocalRuntime('ready'), () => 'sk-or-test');
    first.setBackend('openrouter-image');

    const reopened = new ImageGenStore(fakeLocalRuntime('ready'), () => 'sk-or-test');

    expect(reopened.backendChoice).toBe('openrouter-image');
    expect(reopened.backend).toBe('openrouter-image');
  });

  it('falls back to OpenRouter when ComfyUI is picked but not ready', () => {
    const store = new ImageGenStore(fakeLocalRuntime('offline'), () => 'sk-or-test');
    store.setBackend('local-comfy');

    expect(store.backendChoice).toBe('local-comfy');
    expect(store.backend).toBe('openrouter-image');
    expect(store.toBackendConfig().primary).toBe('openrouter-image');
  });

  it('falls back to ComfyUI when OpenRouter is picked without a key and ComfyUI is ready', () => {
    const store = new ImageGenStore(fakeLocalRuntime('ready'), () => undefined);
    store.setBackend('openrouter-image');

    expect(store.backendChoice).toBe('openrouter-image');
    expect(store.backend).toBe('local-comfy');
    expect(store.toBackendConfig().primary).toBe('local-comfy');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageGenStore } from '../../src/stores/ImageGenStore';
import { clearAppStorage } from '../helpers/storage';

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
});

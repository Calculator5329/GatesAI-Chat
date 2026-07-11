import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadImageGenConfig } from '../../src/services/imageGenStorage';
import { clearAppStorage } from '../helpers/storage';

describe('imageGenStorage', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('defaults local ComfyUI generation to normal FLUX.2 Klein without upscale', () => {
    const config = loadImageGenConfig();

    expect(config.backend).toBe('openrouter-image');
    expect(config.comfyQualityPreset).toBe('full');
    expect(config.comfyUpscaleFactor).toBe(1);
    expect(config.comfyQualitySteps).toBe(12);
    expect(config.comfyDraftSteps).toBe(8);
    expect(config.comfyCfg).toBe(1);
  });

  it('clamps persisted sampling controls to supported safe ranges', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      comfyQualitySteps: 2,
      comfyDraftSteps: 100,
      comfyCfg: 0,
    }));

    const config = loadImageGenConfig();
    expect(config.comfyQualitySteps).toBe(6);
    expect(config.comfyDraftSteps).toBe(50);
    expect(config.comfyCfg).toBe(0.1);
  });

  it('drops the stale FLUX 2-dev workspace workflow path and migrates old full preset name on load', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      comfyQualityPreset: 'final',
      comfyWorkflowPath: 'notes/flux2-workflow.json',
    }));

    const config = loadImageGenConfig();

    expect(config.backend).toBe('local-comfy');
    expect(config.comfyQualityPreset).toBe('full');
    expect(config.comfyWorkflowPath).toBeUndefined();
  });

  it('migrates the old quick preset name to normal FLUX.2 Klein on load', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      comfyQualityPreset: 'draft',
      comfyUpscaleFactor: 2,
    }));

    const config = loadImageGenConfig();

    expect(config.comfyQualityPreset).toBe('full');
    expect(config.comfyUpscaleFactor).toBe(1);
  });

  it('migrates stored quick configs to the new normal default', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      comfyQualityPreset: 'quick',
      comfyUpscaleFactor: 3,
    }));

    const config = loadImageGenConfig();

    expect(config.comfyQualityPreset).toBe('full');
    expect(config.comfyUpscaleFactor).toBe(1);
  });

  it('migrates retired image backends to OpenRouter image generation', () => {
    for (const backend of ['local-a1111', 'cloud-openrouter', 'cloud-openai', 'cloud-gemini']) {
      clearAppStorage();
      localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({ backend }));

      const config = loadImageGenConfig();

      expect(config.backend).toBe('openrouter-image');
    }
  });

  it('drops retired local/cloud/prompt enhancement fields on load', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      a1111BaseUrl: 'http://127.0.0.1:7860',
      a1111ApiKey: 'a-key',
      promptEnhancement: 'llm',
      promptEnhancementOptIn: true,
      promptStylePreset: 'photorealistic',
      openRouterImageModelId: 'openai/gpt-image',
      openAiImageModelId: 'gpt-image-2',
      geminiImageModelId: 'gemini-image',
      openAiImageQuality: 'high',
    }));

    const config = loadImageGenConfig();

    expect('promptEnhancement' in config).toBe(false);
    expect('promptEnhancementOptIn' in config).toBe(false);
    expect('promptStylePreset' in config).toBe(false);
    expect('a1111BaseUrl' in config).toBe(false);
    expect('a1111ApiKey' in config).toBe(false);
    expect('openRouterImageModelId' in config).toBe(false);
    expect('openAiImageModelId' in config).toBe(false);
    expect('geminiImageModelId' in config).toBe(false);
    expect('openAiImageQuality' in config).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadImageGenConfig } from '../../src/services/imageGenStorage';
import { clearAppStorage } from '../helpers/storage';

describe('imageGenStorage', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('defaults local ComfyUI generation to normal FLUX.2 Klein without upscale', () => {
    const config = loadImageGenConfig();

    expect(config.comfyQualityPreset).toBe('full');
    expect(config.comfyUpscaleFactor).toBe(1);
  });

  it('defaults prompt enhancement to off so prompts are used verbatim', () => {
    const config = loadImageGenConfig();

    expect(config.promptEnhancement).toBe('off');
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

  it('migrates the old implicit prompt enhancement default to off', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      promptEnhancement: 'llm',
    }));

    const config = loadImageGenConfig();

    expect(config.promptEnhancement).toBe('off');
  });

  it('preserves explicit prompt enhancement opt-in', () => {
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      promptEnhancement: 'llm',
      promptEnhancementOptIn: true,
    }));

    const config = loadImageGenConfig();

    expect(config.promptEnhancement).toBe('llm');
  });
});

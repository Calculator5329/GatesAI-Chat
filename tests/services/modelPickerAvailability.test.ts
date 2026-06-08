import { describe, expect, it } from 'vitest';
import {
  availableSources,
  isModelAvailable,
  isProviderAvailable,
  isVerifiedModelId,
  type RuntimeAvailability,
} from '../../src/core/modelPickerAvailability';
import { DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from '../../src/core/models';

const desktopAllOff: RuntimeAvailability = { webLite: false, ollamaOnline: false, comfyReady: false };
const desktopAllOn: RuntimeAvailability = { webLite: false, ollamaOnline: true, comfyReady: true };
const webLiteAllOn: RuntimeAvailability = { webLite: true, ollamaOnline: true, comfyReady: true };

describe('availableSources', () => {
  it('always offers auto and cloud', () => {
    expect(availableSources(desktopAllOff)).toEqual(['auto', 'cloud']);
  });

  it('adds local only when ollama is online on desktop', () => {
    expect(availableSources({ ...desktopAllOff, ollamaOnline: true })).toEqual(['auto', 'cloud', 'local']);
  });

  it('adds image only when comfy is ready on desktop', () => {
    expect(availableSources({ ...desktopAllOff, comfyReady: true })).toEqual(['auto', 'cloud', 'image']);
  });

  it('exposes all sources when everything is ready on desktop', () => {
    expect(availableSources(desktopAllOn)).toEqual(['auto', 'cloud', 'local', 'image']);
  });

  it('never offers local or image in web-lite, even with backends reporting ready', () => {
    expect(availableSources(webLiteAllOn)).toEqual(['auto', 'cloud']);
  });
});

describe('isProviderAvailable / isModelAvailable', () => {
  it('treats openrouter as always available', () => {
    expect(isProviderAvailable('openrouter', desktopAllOff)).toBe(true);
    expect(isProviderAvailable('openrouter', webLiteAllOn)).toBe(true);
  });

  it('gates ollama on desktop + online', () => {
    expect(isProviderAvailable('ollama', desktopAllOff)).toBe(false);
    expect(isProviderAvailable('ollama', { ...desktopAllOff, ollamaOnline: true })).toBe(true);
    expect(isProviderAvailable('ollama', webLiteAllOn)).toBe(false);
  });

  it('gates local-image on desktop + comfyReady', () => {
    expect(isProviderAvailable('local-image', desktopAllOff)).toBe(false);
    expect(isProviderAvailable('local-image', { ...desktopAllOff, comfyReady: true })).toBe(true);
    expect(isProviderAvailable('local-image', webLiteAllOn)).toBe(false);
  });

  it('reads provider off the model', () => {
    expect(isModelAvailable({ providerId: 'ollama' }, desktopAllOn)).toBe(true);
    expect(isModelAvailable({ providerId: 'local-image' }, desktopAllOff)).toBe(false);
  });
});

describe('isVerifiedModelId', () => {
  it('matches the live-tested catalog', () => {
    for (const id of DEFAULT_OPENROUTER_CATALOG_MODEL_IDS) {
      expect(isVerifiedModelId(id)).toBe(true);
    }
  });

  it('rejects unknown and local ids', () => {
    expect(isVerifiedModelId('image-direct-comfy')).toBe(false);
    expect(isVerifiedModelId('ollama-llama3')).toBe(false);
    expect(isVerifiedModelId('nope')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_RUNTIME_CONFIG, parseLocalRuntimeConfig } from '../../../src/services/local/localRuntimeStorage';

describe('parseLocalRuntimeConfig', () => {
  it('reads a config saved before preferLocalModels existed as prefer-local on', () => {
    const parsed = parseLocalRuntimeConfig({
      ollama: { installPath: '/usr/bin/ollama', managed: true, baseUrl: '192.168.1.20' },
      comfyui: { installPath: '', managed: false, baseUrl: 'http://127.0.0.1:8000/' },
      visionModel: 'gemma4:12b',
      autoDetectComplete: true,
      autoDetectAt: 1,
    });

    expect(parsed).toEqual({
      ollama: { baseUrl: 'http://192.168.1.20:11434' },
      comfyui: { baseUrl: 'http://127.0.0.1:8000' },
      visionModel: 'gemma4:12b',
      preferLocalModels: true,
    });
  });

  it('keeps an explicit preferLocalModels: false', () => {
    expect(parseLocalRuntimeConfig({ preferLocalModels: false }).preferLocalModels).toBe(false);
  });

  it('falls back to defaults for missing or malformed data', () => {
    expect(parseLocalRuntimeConfig(undefined)).toEqual(DEFAULT_LOCAL_RUNTIME_CONFIG);
    expect(parseLocalRuntimeConfig({ ollama: 'nope', comfyui: { baseUrl: 42 }, preferLocalModels: 'yes' }))
      .toEqual(DEFAULT_LOCAL_RUNTIME_CONFIG);
  });
});

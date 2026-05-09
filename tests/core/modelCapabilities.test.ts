import { describe, expect, it } from 'vitest';
import { modelSupportsVision } from '../../src/core/modelCapabilities';

describe('modelSupportsVision', () => {
  it('recognizes vision models behind OpenRouter by underlying vendor id', () => {
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'google/gemini-3-flash-preview' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'openai/gpt-5.5' })).toBe(true);
  });

  it('rejects text-only OpenRouter models', () => {
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro' })).toBe(false);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6' })).toBe(false);
  });

  it('detects Ollama vision models by name pattern', () => {
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'llava:13b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'qwen2.5vl:7b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'llama3.2-vision:11b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'minicpm-v:latest' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'pixtral:12b' })).toBe(true);
  });

  it('defaults Ollama text models to no-vision', () => {
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'llama3.1:8b' })).toBe(false);
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'qwen2.5:7b' })).toBe(false);
  });

  it('honors an explicit supportsVision override', () => {
    expect(modelSupportsVision({ providerId: 'ollama', providerModelId: 'llama3.1:8b', supportsVision: true })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.7', supportsVision: false })).toBe(false);
  });
});

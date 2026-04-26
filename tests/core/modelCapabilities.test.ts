import { describe, expect, it } from 'vitest';
import { modelSupportsVision } from '../../src/core/modelCapabilities';

describe('modelSupportsVision', () => {
  it('treats all direct Anthropic Claude models as vision-capable', () => {
    expect(modelSupportsVision({ providerId: 'anthropic', providerModelId: 'claude-opus-4-7' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'anthropic', providerModelId: 'claude-haiku-4-5' })).toBe(true);
  });

  it('treats GPT-5, GPT-4o, GPT-4.1, and the o-series as vision-capable', () => {
    expect(modelSupportsVision({ providerId: 'openai', providerModelId: 'gpt-5.5' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openai', providerModelId: 'gpt-4o' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openai', providerModelId: 'gpt-4.1-mini' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openai', providerModelId: 'o3' })).toBe(true);
  });

  it('treats all Gemini variants (pro / flash / image) as vision-capable', () => {
    expect(modelSupportsVision({ providerId: 'gemini', providerModelId: 'gemini-3.1-pro-preview' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'gemini', providerModelId: 'gemini-3.1-flash-image-preview' })).toBe(true);
  });

  it('recognizes vision models behind OpenRouter by underlying vendor id', () => {
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'google/gemini-3-flash-preview' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'openai/gpt-5.5' })).toBe(true);
  });

  it('rejects text-only OpenRouter models', () => {
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro' })).toBe(false);
    expect(modelSupportsVision({ providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6' })).toBe(false);
  });

  it('detects local vision models by name pattern', () => {
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'llava:13b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'qwen2.5vl:7b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'llama3.2-vision:11b' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'minicpm-v:latest' })).toBe(true);
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'pixtral:12b' })).toBe(true);
  });

  it('defaults local text models and Groq to no-vision', () => {
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'llama3.1:8b' })).toBe(false);
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'qwen2.5:7b' })).toBe(false);
    expect(modelSupportsVision({ providerId: 'groq', providerModelId: 'llama-3.3-70b-versatile' })).toBe(false);
  });

  it('honors an explicit supportsVision override', () => {
    expect(modelSupportsVision({ providerId: 'local', providerModelId: 'llama3.1:8b', supportsVision: true })).toBe(true);
    expect(modelSupportsVision({ providerId: 'anthropic', providerModelId: 'claude-opus-4-7', supportsVision: false })).toBe(false);
  });
});

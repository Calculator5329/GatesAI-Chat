import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../../src/core/llm';
import { generateThreadTitle } from '../../src/services/threadNamer';

describe('generateThreadTitle', () => {
  it('prefers Gemini 3.1 Flash Lite through OpenRouter for cheap titles', async () => {
    const calls: LlmRequest[] = [];
    const provider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream(req) {
        calls.push(req);
        yield { type: 'text', delta: 'Polish Plan' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const router = {
      resolve: (modelId: string) => {
        if (modelId !== 'or-gemini-3.1-flash-lite') throw new Error(`unexpected model ${modelId}`);
        return { provider, providerModelId: 'google/gemini-3.1-flash-lite-preview' };
      },
    };

    await expect(generateThreadTitle({
      userText: 'Can we polish the foundation?',
      assistantText: 'Yes, here is a plan.',
      fallbackModelId: 'or-gemini-3-flash',
    }, router)).resolves.toBe('Polish Plan');
    expect(calls[0].modelId).toBe('google/gemini-3.1-flash-lite-preview');
  });
});

import { describe, expect, it, vi } from 'vitest';
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
        return { provider, providerModelId: 'google/gemini-3.1-flash-lite' };
      },
    };

    await expect(generateThreadTitle({
      userText: 'Can we polish the foundation?',
      assistantText: 'Yes, here is a plan.',
      fallbackModelId: 'or-gemini-3-flash',
    }, router)).resolves.toBe('Polish Plan');
    expect(calls[0].modelId).toBe('google/gemini-3.1-flash-lite');
  });

  it('times out a stalled stream instead of hanging the namer forever', async () => {
    // A provider whose stream never yields and never returns — the bug was that
    // `naming` would stay true forever waiting on it.
    const provider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream() {
        await new Promise<void>(() => { /* never resolves */ });
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const router = { resolve: () => ({ provider, providerModelId: 'x' }) };

    vi.useFakeTimers();
    try {
      const pending = generateThreadTitle(
        { userText: 'q', assistantText: 'a', fallbackModelId: 'or-gemini-3-flash' },
        router,
      );
      // Three candidates (two cascade + fallback), each with its own 15s timeout.
      await vi.advanceTimersByTimeAsync(15_000 * 3 + 100);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

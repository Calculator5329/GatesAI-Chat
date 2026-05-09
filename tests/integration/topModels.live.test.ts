/**
 * Live integration smoke tests for the top user-facing models in the
 * curated catalog. Each case sends a tiny prompt and asserts a non-empty
 * text response within 30 seconds.
 *
 * These tests hit real provider APIs — they cost (a tiny amount of) money
 * and require network. Excluded from `npm run test`. Run on demand:
 *
 *   OPENROUTER_API_KEY=... npm run test:models
 *
 * Cases without their corresponding key set are skipped (not failed) so
 * partial runs are useful.
 */
import { describe, it, expect } from 'vitest';
import { LlmRouter } from '../../src/services/llm/router';
import type { ProviderConfigs } from '../../src/core/llm';
import type { Model } from '../../src/core/types';
import { MODELS } from '../../src/core/models';

const KEYS = {
  openrouter: process.env.OPENROUTER_API_KEY,
};

const CONFIGS: ProviderConfigs = {
  ...(KEYS.openrouter ? { openrouter: { apiKey: KEYS.openrouter } } : {}),
};

function registryOf(models: readonly Model[]) {
  return {
    all: [...models],
    findById: (id: string) => models.find(m => m.id === id),
  };
}

const router = new LlmRouter(registryOf(MODELS), CONFIGS);

interface Case {
  modelId: string;
  /** Which env key gates this case. */
  requires: keyof typeof KEYS;
  label: string;
}

const CASES: Case[] = [
  { modelId: 'or-claude-opus-4.7',       requires: 'openrouter', label: 'Claude Opus 4.7 (via OR)' },
  { modelId: 'or-claude-sonnet-4.6',     requires: 'openrouter', label: 'Claude Sonnet 4.6 (via OR)' },
  { modelId: 'or-gpt-5.5-pro',           requires: 'openrouter', label: 'GPT-5.5 Pro (via OR)' },
  { modelId: 'or-gpt-5.5',               requires: 'openrouter', label: 'GPT-5.5 (via OR)' },
  { modelId: 'or-gemini-3.1-pro',        requires: 'openrouter', label: 'Gemini 3.1 Pro (via OR)' },
  { modelId: 'or-gemini-3-flash',        requires: 'openrouter', label: 'Gemini 3 Flash (via OR)' },
  { modelId: 'or-gemini-3.1-flash-lite', requires: 'openrouter', label: 'Gemini 3.1 Flash Lite (via OR)' },
];

describe('top models — live smoke', () => {
  for (const c of CASES) {
    const skip = !KEYS[c.requires];
    (skip ? it.skip : it)(`${c.label} streams a non-empty reply`, async () => {
      const { provider, providerModelId } = router.resolve(c.modelId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('test timeout'), 30_000);

      let text = '';
      let finishReason: string | undefined;
      let errorMessage: string | undefined;

      try {
        for await (const chunk of provider.stream(
          {
            modelId: providerModelId,
            messages: [{ role: 'user', content: 'Reply with exactly the word: pong.' }],
            // 256 tokens leaves headroom for reasoning-model thinking budgets
            // (Gemini 3 Pro / GPT-5.5 Pro burn invisible thinking tokens
            // against this cap; 16 was too tight and produced empty replies
            // with finish=length).
            maxTokens: 256,
            temperature: 0,
            tools: [],
          },
          controller.signal,
        )) {
          if (chunk.type === 'text') text += chunk.delta;
          else if (chunk.type === 'done') {
            finishReason = chunk.finishReason;
            if (chunk.error) errorMessage = chunk.error;
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }

      // Diagnostic-friendly: include what we did get if the assert fails.
      expect(
        text.trim().length,
        `expected non-empty text; got "${text}" finish=${finishReason} error=${errorMessage}`,
      ).toBeGreaterThan(0);
    }, 35_000);
  }
});

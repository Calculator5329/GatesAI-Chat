import { describe, expect, it, vi } from 'vitest';
import { enhancePrompt } from '../../../src/services/image/promptEnhancer';

describe('enhancePrompt', () => {
  it('returns the cleaned LLM prompt', async () => {
    const seen: string[] = [];
    const llmComplete = vi.fn(async (messages: Array<{ content: string }>) => {
      seen.push(messages[0]?.content ?? '');
      return ' "cinematic neon city, wide angle, violet rim light" ';
    });

    const out = await enhancePrompt({
      prompt: 'neon city',
      stylePreset: 'auto',
      llmComplete,
    });

    expect(out).toBe('cinematic neon city, wide angle, violet rim light');
    expect(llmComplete).toHaveBeenCalledOnce();
    expect(seen[0]).toContain('User prompt: neon city');
  });

  it('falls back to the original prompt when enhancement fails', async () => {
    const out = await enhancePrompt({
      prompt: 'quiet forest',
      stylePreset: 'photorealistic',
      llmComplete: async () => {
        throw new Error('offline');
      },
    });

    expect(out).toBe('quiet forest');
  });
});

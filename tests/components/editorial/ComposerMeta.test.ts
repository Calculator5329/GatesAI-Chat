import { describe, expect, it } from 'vitest';
import type { StreamActivity } from '../../../src/core/types';
import { streamFooterLabel } from '../../../src/components/editorial/composer/ComposerMeta';

function activity(phase: StreamActivity['phase'], providerId: string, providerModelId = 'test-model'): StreamActivity {
  return {
    messageId: 'assistant-1',
    phase,
    startedAt: 1,
    lastProviderAt: 1,
    round: 0,
    providerId,
    providerModelId,
  };
}

describe('ComposerMeta stream footer', () => {
  it('uses local wording for every Ollama phase', () => {
    const labels = [
      streamFooterLabel(activity('connecting', 'ollama', 'phi4:latest')),
      streamFooterLabel(activity('streaming', 'ollama')),
      streamFooterLabel(activity('tooling', 'ollama')),
      streamFooterLabel(activity('stalled', 'ollama')),
    ];

    expect(labels).toEqual([
      'loading phi4:latest locally...',
      'streaming locally...',
      'running tools...',
      'local model paused',
    ]);
    expect(labels.join(' ')).not.toMatch(/provider/i);
  });

  it('preserves remote-provider wording', () => {
    expect(streamFooterLabel(activity('connecting', 'openrouter'))).toBe('waiting for provider...');
    expect(streamFooterLabel(activity('stalled', 'openrouter'))).toBe('provider stalled');
  });
});

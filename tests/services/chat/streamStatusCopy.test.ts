import { describe, expect, it } from 'vitest';
import { buildActivitiesForMessage } from '../../../src/services/chat/activityProjection';
import { isLocalStreamProvider, streamStatusCopy } from '../../../src/services/chat/streamStatusCopy';

describe('streamStatusCopy', () => {
  it('uses local-first copy throughout an Ollama turn', () => {
    const statuses = [
      streamStatusCopy({ phase: 'connecting', providerId: 'ollama', providerModelId: 'phi4:latest' }),
      streamStatusCopy({ phase: 'streaming', providerId: 'ollama' }),
      streamStatusCopy({ phase: 'stalled', providerId: 'ollama', idleSeconds: 120 }),
    ];

    expect(statuses[0].verb).toBe('Loading phi4:latest locally');
    expect(statuses[1].verb).toBe('Streaming locally');
    expect(statuses[2]).toEqual({
      verb: 'Local model paused',
      stallReason: 'The local runtime sent no data for 120s, so GatesAI stopped the stalled stream.',
    });
    expect(statuses.flatMap(status => [status.verb, status.stallReason ?? '']).join(' ')).not.toMatch(/provider/i);
  });

  it('preserves remote-provider copy', () => {
    expect(streamStatusCopy({ phase: 'connecting', providerId: 'openrouter' })).toEqual({
      verb: 'Waiting for provider',
    });
    expect(streamStatusCopy({ phase: 'stalled', providerId: 'openrouter', idleSeconds: 180 })).toEqual({
      verb: 'Provider stalled',
      stallReason: 'No provider data arrived for 180s, so GatesAI stopped the stalled stream.',
    });
  });

  it('does not guess that an OpenAI-compatible endpoint is local', () => {
    expect(isLocalStreamProvider('ollama')).toBe(true);
    expect(isLocalStreamProvider('local-image')).toBe(true);
    expect(isLocalStreamProvider('openai-compat')).toBe(false);
    expect(streamStatusCopy({ phase: 'connecting', providerId: 'openai-compat' }).verb).toBe('Waiting for provider');
  });

  it('keeps pre-token activity labels provider-neutral', () => {
    expect(streamStatusCopy({ phase: 'streaming', providerId: 'ollama', preTokenLabel: 'compacting' }).verb).toBe('Compacting');
    expect(streamStatusCopy({ phase: 'streaming', providerId: 'openrouter', preTokenLabel: 'responding' }).verb).toBe('Responding');
  });

  it('projects local connecting and stalled activity without provider-framed UI copy', () => {
    const message = { id: 'assistant-1', role: 'assistant' as const, content: '', createdAt: 1 };
    const connecting = buildActivitiesForMessage({
      message,
      streaming: true,
      ownerThreadId: 'thread-1',
      extras: undefined,
      streamActivity: {
        messageId: message.id,
        phase: 'connecting',
        startedAt: 1,
        lastProviderAt: 1,
        round: 0,
        providerId: 'ollama',
        providerModelId: 'phi4:latest',
      },
    });
    const stalled = buildActivitiesForMessage({
      message,
      streaming: true,
      ownerThreadId: 'thread-1',
      extras: undefined,
      streamActivity: {
        messageId: message.id,
        phase: 'stalled',
        startedAt: 1,
        lastProviderAt: 2,
        round: 0,
        providerId: 'ollama',
        providerModelId: 'phi4:latest',
      },
    });

    expect(connecting[0]?.verb).toBe('Loading phi4:latest locally');
    expect(stalled[0]).toMatchObject({
      verb: 'Local model paused',
      summary: expect.stringContaining('local runtime'),
    });
    expect([...connecting, ...stalled].map(item => `${item.verb} ${item.summary ?? ''}`).join(' ')).not.toMatch(/provider/i);
  });
});

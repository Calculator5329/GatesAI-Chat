import { describe, expect, it } from 'vitest';
import {
  accumulateToolCallDelta,
  createToolCallDeltaState,
  finalizeToolCallDeltas,
  normalizeFinishReason,
} from '../../../src/services/llm/streamCore';

describe('streamCore', () => {
  it('accumulates interleaved tool-call fragments across chunks', () => {
    const state = createToolCallDeltaState();

    accumulateToolCallDelta(state, { index: 0, id: 'call_a', function: { name: 'alpha', arguments: '{"x":' } });
    accumulateToolCallDelta(state, { index: 1, id: 'call_b', function: { name: 'beta', arguments: '{"text":"' } });
    accumulateToolCallDelta(state, { index: 0, function: { arguments: '1}' } });
    accumulateToolCallDelta(state, { index: 1, function: { arguments: 'hi"}' } });

    expect(finalizeToolCallDeltas(state)).toEqual([
      { id: 'call_a', name: 'alpha', arguments: { x: 1 } },
      { id: 'call_b', name: 'beta', arguments: { text: 'hi' } },
    ]);
  });

  it('finalizes out-of-order indexes in index order', () => {
    const state = createToolCallDeltaState();

    accumulateToolCallDelta(state, { index: 2, function: { name: 'third', arguments: '{}' } });
    accumulateToolCallDelta(state, { index: 0, function: { name: 'first', arguments: '{}' } });
    accumulateToolCallDelta(state, { index: 1, function: { name: 'second', arguments: '{}' } });

    expect(finalizeToolCallDeltas(state, name => `fallback-${name}`).map(call => call.name))
      .toEqual(['first', 'second', 'third']);
  });

  it('normalizes provider finish reasons through one table', () => {
    expect(normalizeFinishReason('stop')).toBe('stop');
    expect(normalizeFinishReason('done')).toBe('stop');
    expect(normalizeFinishReason(true)).toBe('stop');
    expect(normalizeFinishReason('length')).toBe('length');
    expect(normalizeFinishReason('max_tokens')).toBe('length');
    expect(normalizeFinishReason('max_output_tokens')).toBe('length');
    expect(normalizeFinishReason('tool_calls')).toBe('tool_use');
    expect(normalizeFinishReason('tool_use')).toBe('tool_use');
    expect(normalizeFinishReason('content_filter')).toBe('content_filter');
    expect(normalizeFinishReason('unknown')).toBeUndefined();
    expect(normalizeFinishReason(null)).toBeUndefined();
    expect(normalizeFinishReason(false)).toBeUndefined();
  });

  it('skips malformed tool-call fragments without throwing', () => {
    const state = createToolCallDeltaState();

    expect(() => {
      for (const fragment of [
        null,
        'not an object',
        {},
        { index: '0', function: { name: 'bad', arguments: '{}' } },
        { index: 0.5, function: { name: 'bad', arguments: '{}' } },
        { index: 1, function: { name: 42, arguments: { not: 'a string delta' } } },
      ]) {
        accumulateToolCallDelta(state, fragment);
      }
      accumulateToolCallDelta(state, { index: 0, function: { name: 'valid', arguments: '{"ok":true}' } });
    }).not.toThrow();

    expect(finalizeToolCallDeltas(state)).toEqual([
      expect.objectContaining({ name: 'valid', arguments: { ok: true } }),
    ]);
  });
});

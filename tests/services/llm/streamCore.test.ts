import { describe, expect, it } from 'vitest';
import {
  accumulateToolCallDelta,
  createToolCallDeltaState,
  finalizeToolCallDeltas,
  jsonLinesAdapter,
  normalizeFinishReason,
  readTextFrames,
  sseDataAdapter,
} from '../../../src/services/llm/streamCore';

describe('streamCore', () => {
  it('shares chunked UTF-8 framing while adapters preserve SSE and JSON-lines syntax', async () => {
    const encoded = new TextEncoder().encode('event: ping\r\ndata: {"text":"hé"}\r\n\r\n{"done":false}\n{"done":true}');
    const chunks = [encoded.slice(0, 22), encoded.slice(22, 29), encoded.slice(29)];
    const stream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(chunk));
        controller.close();
      },
    });

    const sse: string[] = [];
    for await (const frame of readTextFrames(stream(), sseDataAdapter())) sse.push(frame);
    expect(sse).toEqual(['{"text":"hé"}']);

    const lines: string[] = [];
    for await (const frame of readTextFrames(stream(), jsonLinesAdapter())) lines.push(frame);
    expect(lines).toEqual([
      'event: ping',
      'data: {"text":"hé"}',
      '{"done":false}',
      '{"done":true}',
    ]);
  });

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

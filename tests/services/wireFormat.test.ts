import { describe, expect, it } from 'vitest';
import { flattenForWire } from '../../src/services/llm/wireFormat';
import type { Message } from '../../src/core/types';

describe('flattenForWire', () => {
  it('expands a stored assistant turn into calls, ordered tool results, and final text', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'read files', createdAt: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Done.',
        createdAt: 2,
        toolCalls: [
          { id: 'c1', name: 'fs', arguments: { action: 'read', path: 'a.txt' } },
          { id: 'c2', name: 'time', arguments: {} },
        ],
        toolResults: [
          { toolCallId: 'c2', toolName: 'time', content: 'iso: now', ranAt: 3 },
          { toolCallId: 'c1', toolName: 'fs', content: 'file a', ranAt: 4 },
        ],
      },
    ];

    const wire = flattenForWire(messages);

    expect(wire.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    expect(wire[1]).toMatchObject({ role: 'assistant', content: '', toolCalls: messages[1].role === 'assistant' ? messages[1].toolCalls : [] });
    expect(wire[2]).toMatchObject({ role: 'tool', toolCallId: 'c1', toolName: 'fs', content: 'file a' });
    expect(wire[3]).toMatchObject({ role: 'tool', toolCallId: 'c2', toolName: 'time', content: 'iso: now' });
    expect(wire[4]).toMatchObject({ role: 'assistant', content: 'Done.' });
  });

  it('fills missing tool results with an interrupted placeholder', () => {
    const wire = flattenForWire([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: 1,
        toolCalls: [{ id: 'c1', name: 'fs', arguments: { action: 'read' } }],
        toolResults: [],
      },
    ]);

    expect(wire).toHaveLength(2);
    expect(wire[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      toolName: 'fs',
      content: '[no result — execution interrupted]',
    });
  });
});

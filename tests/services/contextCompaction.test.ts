import { describe, expect, it } from 'vitest';
import type { Thread, ToolResult } from '../../src/core/types';
import {
  COMPACTED_TOOL_RESULT_PREFIX,
  compactLargeToolResultsInThread,
  deterministicCompactToolResult,
  isCompactedToolResult,
} from '../../src/services/llm/contextCompaction';

describe('contextCompaction', () => {
  it('deterministically compacts a large tool result while preserving artifact paths', () => {
    const result: ToolResult = {
      toolCallId: 'call-1',
      toolName: 'fs',
      content: [
        'path: /workspace/artifacts/long_term_financial_plan_all_sources_complete.json',
        'mime: application/json',
        'x'.repeat(50_000),
      ].join('\n'),
      ranAt: Date.now(),
    };

    const compacted = deterministicCompactToolResult(result);

    expect(compacted).toContain(COMPACTED_TOOL_RESULT_PREFIX);
    expect(compacted).toContain('/workspace/artifacts/long_term_financial_plan_all_sources_complete.json');
    expect(compacted.length).toBeLessThan(2_000);
    expect(isCompactedToolResult(compacted)).toBe(true);
  });

  it('compacts large tool results in a thread and skips small or already compacted results', async () => {
    const thread = makeThread([
      {
        toolCallId: 'large',
        toolName: 'fs',
        content: 'path: /workspace/artifacts/huge.json\n' + 'a'.repeat(40_000),
        ranAt: Date.now(),
      },
      {
        toolCallId: 'small',
        toolName: 'fs',
        content: 'small result',
        ranAt: Date.now(),
      },
      {
        toolCallId: 'already',
        toolName: 'fs',
        content: `${COMPACTED_TOOL_RESULT_PREFIX}\nsummary: done`,
        ranAt: Date.now(),
      },
    ]);

    const outcome = await compactLargeToolResultsInThread(thread, { minChars: 10_000 });

    expect(outcome.compactedCount).toBe(1);
    const results = thread.messages[1].role === 'assistant' ? thread.messages[1].toolResults ?? [] : [];
    expect(results.find(r => r.toolCallId === 'large')?.content).toContain(COMPACTED_TOOL_RESULT_PREFIX);
    expect(results.find(r => r.toolCallId === 'large')?.content).toContain('/workspace/artifacts/huge.json');
    expect(results.find(r => r.toolCallId === 'small')?.content).toBe('small result');
    expect(results.find(r => r.toolCallId === 'already')?.content).toBe(`${COMPACTED_TOOL_RESULT_PREFIX}\nsummary: done`);
  });

  it('can route content replacement through a caller-provided writer', async () => {
    const thread = makeThread([{
      toolCallId: 'large',
      toolName: 'fs',
      content: 'path: /workspace/artifacts/huge.json\n' + 'a'.repeat(40_000),
      ranAt: Date.now(),
    }]);
    const writes: string[] = [];

    await compactLargeToolResultsInThread(thread, {
      minChars: 10_000,
      replaceContent: (result, content) => {
        writes.push(`${result.toolCallId}:${content.slice(0, COMPACTED_TOOL_RESULT_PREFIX.length)}`);
        result.content = content;
      },
    });

    expect(writes).toEqual([`large:${COMPACTED_TOOL_RESULT_PREFIX}`]);
  });
});

function makeThread(toolResults: ToolResult[]): Thread {
  return {
    id: 't',
    title: 'Thread',
    subtitle: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    modelId: 'or-gpt-5.5',
    messages: [
      { id: 'u', role: 'user', content: 'read it', createdAt: Date.now() },
      {
        id: 'a',
        role: 'assistant',
        content: 'read',
        createdAt: Date.now(),
        toolCalls: toolResults.map(r => ({ id: r.toolCallId, name: r.toolName, arguments: { action: 'read' } })),
        toolResults,
      },
    ],
  };
}

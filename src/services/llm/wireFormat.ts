import type { LlmMessage } from '../../core/llm';
import type { Message } from '../../core/types';

/**
 * Translate stored {@link Message}s into the wire-level {@link LlmMessage}
 * sequence every provider expects.
 *
 * Storage uses ONE assistant message per user turn — even when the turn
 * involved several model→tool round trips. The wire format wants those
 * rounds expanded back out: `[assistant(toolCalls), tool, tool, ...,
 * assistant(text)]`. We're the only place that knows how to translate
 * between the two shapes.
 *
 * Expansion rules for one stored assistant turn:
 *   - If it has no calls: emit a single `{ assistant, content }`.
 *   - If it has calls: emit `{ assistant, content: '', toolCalls }`
 *     followed by one `{ role: 'tool' }` per result (paired by id),
 *     then a final `{ assistant, content: <prose> }` with the model's
 *     finalized reply (only when prose is non-empty — otherwise the turn
 *     genuinely ended on a tool call, e.g. mid-stream).
 *
 * This means the model sees its own tool calls cleanly separated from
 * its final prose, even though we store both on one row. A missing
 * result (interrupted) is surfaced as a synthetic error so the wire
 * format isn't malformed — every provider rejects a dangling call id.
 */
export function flattenForWire(messages: Message[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    const hasContent = m.content.trim().length > 0;
    const calls = m.toolCalls ?? [];
    const results = m.toolResults ?? [];
    if (!hasContent && calls.length === 0) continue;

    if (calls.length === 0) {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }

    out.push({ role: 'assistant', content: '', toolCalls: calls });

    const usedResultIndexes = new Set<number>();
    for (const call of calls) {
      const resultIndex = results.findIndex((r, index) => !usedResultIndexes.has(index) && r.toolCallId === call.id);
      const r = resultIndex >= 0 ? results[resultIndex] : undefined;
      if (resultIndex >= 0) usedResultIndexes.add(resultIndex);
      out.push({
        role: 'tool',
        content: r?.content ?? '[no result — execution interrupted]',
        toolCallId: call.id,
        toolName: r?.toolName ?? call.name,
      });
    }

    if (hasContent) {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

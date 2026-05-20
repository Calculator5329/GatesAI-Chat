// Implements LLM provider plumbing for contextCompaction.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
import type { Thread, ToolResult } from '../../core/types';

export const COMPACTED_TOOL_RESULT_PREFIX = '[compacted tool result]';

const DEFAULT_MIN_CHARS = 12_000;
const DEFAULT_EXCERPT_CHARS = 800;
const MODEL_INPUT_EXCERPT_CHARS = 12_000;
const WORKSPACE_PATH_RE = /\/workspace\/[^\s"'`),\]]+/g;

export interface CompactionOutcome {
  compactedCount: number;
  originalChars: number;
  compactedChars: number;
}

export interface CompactionOptions {
  minChars?: number;
  compactOne?: (result: ToolResult) => Promise<string>;
  replaceContent?: (result: ToolResult, content: string) => void;
}

export async function compactLargeToolResultsInThread(
  thread: Thread,
  options: CompactionOptions = {},
): Promise<CompactionOutcome> {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  let compactedCount = 0;
  let originalChars = 0;
  let compactedChars = 0;

  for (const message of thread.messages) {
    if (message.role !== 'assistant') continue;
    const results = message.toolResults ?? [];
    for (const result of results) {
      if (result.content.length < minChars) continue;
      if (isCompactedToolResult(result.content)) continue;

      const before = result.content.length;
      const compacted = options.compactOne
        ? await options.compactOne(result)
        : deterministicCompactToolResult(result);
      const nextContent = isCompactedToolResult(compacted)
        ? compacted
        : `${COMPACTED_TOOL_RESULT_PREFIX}\n${compacted}`;
      if (options.replaceContent) {
        options.replaceContent(result, nextContent);
      } else {
        result.content = nextContent;
      }
      compactedCount++;
      originalChars += before;
      compactedChars += nextContent.length;
    }
  }

  return { compactedCount, originalChars, compactedChars };
}

export function deterministicCompactToolResult(result: ToolResult): string {
  const paths = Array.from(new Set(result.content.match(WORKSPACE_PATH_RE) ?? []));
  const first = result.content.slice(0, DEFAULT_EXCERPT_CHARS).trim();
  const last = result.content.slice(-DEFAULT_EXCERPT_CHARS).trim();

  return [
    COMPACTED_TOOL_RESULT_PREFIX,
    `tool: ${result.toolName}`,
    `original_chars: ${result.content.length}`,
    paths.length > 0 ? `workspace_paths:\n${paths.map(p => `- ${p}`).join('\n')}` : 'workspace_paths: []',
    'summary: Large tool output was compacted to keep the conversation within the model context window. Re-read the referenced workspace artifact if exact raw data is needed.',
    'start_excerpt:',
    fence(first),
    'end_excerpt:',
    fence(last),
  ].join('\n');
}

export function isCompactedToolResult(content: string): boolean {
  return content.trimStart().startsWith(COMPACTED_TOOL_RESULT_PREFIX);
}

export function buildToolResultCompactionInput(result: ToolResult): string {
  const paths = Array.from(new Set(result.content.match(WORKSPACE_PATH_RE) ?? []));
  const head = result.content.slice(0, MODEL_INPUT_EXCERPT_CHARS);
  const tail = result.content.slice(-MODEL_INPUT_EXCERPT_CHARS);
  return [
    `tool: ${result.toolName}`,
    `original_chars: ${result.content.length}`,
    paths.length > 0 ? `workspace_paths:\n${paths.map(p => `- ${p}`).join('\n')}` : 'workspace_paths: []',
    'Summarize this tool result for future programmatic continuation. Preserve file paths, schemas, counts, date ranges, and migration-relevant facts. Do not include conversational filler.',
    'start_excerpt:',
    fence(head),
    'end_excerpt:',
    fence(tail),
  ].join('\n');
}

function fence(content: string): string {
  return ['```', content, '```'].join('\n');
}

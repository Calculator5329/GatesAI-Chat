// User/model-facing text for turn-level failure and recovery states:
// provider errors mid-turn, the tool-round cap, repeated side-effect loops,
// interrupted tool batches, and oversized contexts. Pure string builders —
// no store access, no I/O.
import type { AssistantMessage } from '../../core/types';
import type { ToolCall } from '../../core/llm';
import type { ToolValidationResult } from '../tools/registry';
import { isToolFailureContent } from './toolFailureLog';

export function formatProviderErrorRecovery(message: AssistantMessage, error: string): string {
  const normalizedError = normalizeProviderErrorMessage(error);
  const progress = summarizeToolProgress(message);
  if (!progress) return `_Error: ${normalizedError}_`;
  return [
    'I completed local tool work, but the model provider failed before I could finish the final summary.',
    `Provider error: ${normalizedError}`,
    progress,
    'You can continue from the completed tool results above without re-running the successful workspace steps.',
  ].join('\n\n');
}

export function normalizeProviderErrorMessage(message: string): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('openrouter 402')
    || (lower.includes('"code":402') && lower.includes('openrouter'))
    || (lower.includes('requires more credits') && lower.includes('max_tokens'))
  ) {
    return 'OpenRouter 402: credits or provider token budget hit. Add credits, choose a lower-cost model, or reduce the thread context.';
  }
  if (
    (lower.includes('maximum context length') || lower.includes('context length exceeded'))
    && (lower.includes('token') || lower.includes('context'))
  ) {
    return 'The provider token limit was hit. Start a fresh conversation, compact the thread, or reduce the prompt/context and try again.';
  }
  return trimmed;
}

export function formatToolRoundCapMessage(maxRounds: number, message: AssistantMessage): string {
  const progress = summarizeToolProgress(message);
  return [
    `Stopped after ${maxRounds} tool rounds to avoid an infinite loop.`,
    progress ?? 'No completed tool results were available in this turn.',
    'You can ask me to continue from the latest tool results.',
  ].join('\n\n');
}

export function formatRepeatedSideEffectLoopMessage(repeat: { path: string; action: string }): string {
  const action = repeat.action === 'append' ? 'append to' : 'write';
  return [
    `Stopped the local tool loop after it tried to ${action} the same file repeatedly.`,
    `Latest repeated path: ${repeat.path}`,
    'The successful tool results above are still available, so you can open the artifact or ask me to continue from that file.',
  ].join('\n\n');
}

export function formatInterruptedToolBatchSummary(
  invalids: Array<{ index: number; call: ToolCall; validation: ToolValidationResult }>,
  firstInvalidIndex: number,
): string {
  const executed = firstInvalidIndex;
  const prefixSummary = executed === 0
    ? 'No earlier calls were executed.'
    : `${executed} earlier tool call${executed === 1 ? '' : 's'} executed before the invalid call.`;
  return [
    'status: error',
    'tool: tool_batch_policy',
    'error_code: invalid_tool_batch',
    `summary: Tool batch stopped at call ${firstInvalidIndex} because ${invalids.length} tool call${invalids.length === 1 ? '' : 's'} failed validation. ${prefixSummary} The invalid call and all later calls were not executed.`,
    'invalid_calls:',
    ...invalids.map(({ index, call, validation }) => (
      `- call ${index} (${call.name}): ${validation.summary ?? validation.errorCode ?? 'invalid tool call'}`
    )),
    'fix: Correct the invalid call and retry from that point. Do not send placeholder or empty tool arguments. For finished HTML games/apps, prefer one artifact.create_html_artifact call with a complete document under /workspace/artifacts/exports/...',
    'retryable: true',
  ].join('\n');
}

export function summarizeToolProgress(message: AssistantMessage): string | null {
  const results = message.toolResults ?? [];
  if (results.length === 0) return null;
  const failures = results.filter(result => isToolFailureContent(result.toolName, result.content));
  const artifactPaths = new Set<string>();
  for (const result of results) {
    for (const artifact of result.artifacts ?? []) {
      if (artifact.kind === 'image') artifactPaths.add(artifact.path);
      if (artifact.kind === 'image-job') artifactPaths.add(`image job ${artifact.jobId}`);
    }
    for (const match of result.content.matchAll(/\/workspace\/[^\s`)"']+/g)) {
      artifactPaths.add(match[0].replace(/[.,;:]+$/, ''));
    }
  }
  const lines = [
    `Completed tool results: ${results.length}.`,
    failures.length > 0 ? `Tool results with errors: ${failures.length}.` : '',
  ].filter(Boolean);
  const paths = [...artifactPaths].slice(0, 8);
  if (paths.length > 0) {
    lines.push('Artifacts/paths seen:');
    lines.push(...paths.map(path => `- ${path}`));
    if (artifactPaths.size > paths.length) lines.push(`- ...and ${artifactPaths.size - paths.length} more`);
  }
  return lines.join('\n');
}

export function formatOversizedContextMessage(used: number, window: number): string {
  return [
    `This thread is too large to send safely (${formatTokens(used)} of ${formatTokens(window)} tokens estimated).`,
    'Large tool results are still in the conversation context. Compact the thread, start a fresh thread, or reference the generated artifact paths instead of re-reading full files.',
  ].join('\n\n');
}

export function safeStableJson(value: unknown): string {
  try {
    return JSON.stringify(value, Object.keys(value && typeof value === 'object' ? value as Record<string, unknown> : {}).sort());
  } catch {
    return String(value);
  }
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

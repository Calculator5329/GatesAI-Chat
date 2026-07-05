// Executes one round's batch of tool calls for a chat turn: validation,
// prefix-execution when a batch contains invalid calls, parallel read-only
// grouping, cancellation, and structured failure results. Stateless — the
// store passes the facades each call needs via ToolBatchDeps.
import type { ToolCall } from '../../core/llm';
import type { ToolResult } from '../../core/types';
import { toolRegistry, type ToolValidationResult } from '../tools/registry';
import type { ToolContext } from '../tools/types';
import { logEvent } from '../diagnostics/chatLog';
import { isToolFailureContent, logToolCallFailure, safeJsonPreview } from './toolFailureLog';
import { formatInterruptedToolBatchSummary, safeStableJson } from './turnFormatting';

export type ToolStoreContext = Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream' | 'imageGen' | 'imageJobs' | 'localRuntime' | 'search' | 'rag'>;

export interface ToolBatchDeps {
  profile: ToolContext['profile'];
  chat: ToolContext['chat'];
  extras: ToolStoreContext;
}

/** Batches above this size get a warning prepended to the first result. */
export const TOOL_BATCH_WARN_THRESHOLD = 6;

export async function executeToolBatch(
  calls: ToolCall[],
  threadId: string,
  signal: AbortSignal,
  deps: ToolBatchDeps,
): Promise<ToolResult[]> {
  const results = new Array<ToolResult>(calls.length);
  const invalidSeen = new Set<string>();
  const batchStartedAt = Date.now();
  const largeBatchWarning = calls.length > TOOL_BATCH_WARN_THRESHOLD
    ? `status: warning\ntool: tool_batch_policy\nsummary: Large tool batch detected (${calls.length} calls). Prefer ${TOOL_BATCH_WARN_THRESHOLD} or fewer independent calls; dependent file-generation work should be sequential.`
    : null;
  if (largeBatchWarning) {
    logEvent(threadId, 'tool.batch.warning', {
      count: calls.length,
      threshold: TOOL_BATCH_WARN_THRESHOLD,
      toolNames: calls.map(call => call.name),
    });
  }
  const validations = calls.map((call, index) => {
    const validation = toolRegistry.validateToolCall(call);
    logToolValidation(threadId, call, validation, index);
    return validation;
  });
  const invalids = validations
    .map((validation, index) => ({ validation, index, call: calls[index] }))
    .filter(item => !item.validation.ok);
  if (invalids.length > 0) {
    const firstInvalidIndex = invalids[0].index;
    const batchSummary = formatInterruptedToolBatchSummary(invalids, firstInvalidIndex);
    logEvent(threadId, 'tool.batch.interrupted', {
      count: calls.length,
      invalid: invalids.length,
      executedPrefix: firstInvalidIndex,
      invalidIndexes: invalids.map(item => item.index),
      errorCodes: invalids.map(item => item.validation.errorCode),
    });
    if (firstInvalidIndex > 0) {
      const prefixResults = await executeValidatedToolCalls(calls.slice(0, firstInvalidIndex), threadId, signal, deps);
      prefixResults.forEach((result, index) => { results[index] = result; });
    }
    const invalidByIndex = new Map(invalids.map(item => [item.index, item]));
    if (!signal.aborted) {
      for (let index = firstInvalidIndex; index < calls.length; index += 1) {
        const invalid = invalidByIndex.get(index);
        results[index] = invalid
          ? invalidToolCallResult(calls[index], invalid.validation, invalidSeen, threadId, deps, {
              callIndex: index,
              batchSummary,
            })
          : skippedAfterInvalidToolCallResult(calls[index], index, batchSummary, firstInvalidIndex);
      }
    }
    const finished = results.filter(Boolean);
    if (largeBatchWarning && finished[0]) {
      finished[0] = {
        ...finished[0],
        content: `${largeBatchWarning}\n\n${finished[0].content}`,
        outputChars: `${largeBatchWarning}\n\n${finished[0].content}`.length,
      };
    }
    logEvent(threadId, 'tool.batch.finished', {
      count: calls.length,
      results: finished.length,
      invalid: invalids.length,
      skipped: Math.max(0, calls.length - firstInvalidIndex - invalids.length),
      durationMs: Date.now() - batchStartedAt,
      largeBatch: Boolean(largeBatchWarning),
      interrupted: true,
      executedPrefix: firstInvalidIndex,
    });
    return finished;
  }
  const finished = await executeValidatedToolCalls(calls, threadId, signal, deps);
  if (largeBatchWarning && finished[0]) {
    finished[0] = {
      ...finished[0],
      content: `${largeBatchWarning}\n\n${finished[0].content}`,
      outputChars: `${largeBatchWarning}\n\n${finished[0].content}`.length,
    };
  }
  logEvent(threadId, 'tool.batch.finished', {
    count: calls.length,
    results: finished.length,
    invalid: finished.filter(result => result.ok === false).length,
    durationMs: Date.now() - batchStartedAt,
    largeBatch: Boolean(largeBatchWarning),
  });
  return finished;
}

async function executeValidatedToolCalls(
  calls: ToolCall[],
  threadId: string,
  signal: AbortSignal,
  deps: ToolBatchDeps,
): Promise<ToolResult[]> {
  const results = new Array<ToolResult>(calls.length);
  let index = 0;
  while (index < calls.length) {
    if (signal.aborted) break;
    const call = calls[index];
    if (toolRegistry.isReadOnlyCall(call.name, call.arguments)) {
      const groupStart = index;
      const group: ToolCall[] = [];
      while (
        index < calls.length
        && toolRegistry.isReadOnlyCall(calls[index].name, calls[index].arguments)
      ) {
        group.push(calls[index]);
        index += 1;
      }
      const groupResults = await Promise.all(group.map(call => executeOneToolCall(call, threadId, signal, deps)));
      if (signal.aborted) break;
      groupResults.forEach((result, offset) => { results[groupStart + offset] = result; });
    } else {
      const result = await executeOneToolCall(call, threadId, signal, deps);
      if (signal.aborted) break;
      results[index] = result;
      index += 1;
    }
  }
  if (signal.aborted) {
    for (let i = 0; i < calls.length; i += 1) {
      if (!results[i]) results[i] = cancelledToolCallResult(calls[i]);
    }
  }
  return results.filter(Boolean);
}

function cancelledToolCallResult(call: ToolCall): ToolResult {
  const content = 'status: cancelled\ntool: ' + call.name + '\nsummary: Cancelled before this tool finished.';
  return {
    toolCallId: call.id,
    toolName: call.name,
    content,
    summary: 'Cancelled before this tool finished.',
    ok: false,
    errorCode: 'cancelled',
    retryable: true,
    durationMs: 0,
    outputChars: content.length,
    ranAt: Date.now(),
  };
}

function logToolValidation(threadId: string, call: ToolCall, validation: ToolValidationResult, index?: number): void {
  logEvent(threadId, 'tool.call.validated', {
    toolName: call.name,
    toolCallId: call.id,
    ...(index != null ? { index } : {}),
    ok: validation.ok,
    errorCode: validation.errorCode,
    retryable: validation.retryable,
    argumentsPreview: safeJsonPreview(call.arguments),
    hasArgumentParseError: Boolean(call.argumentsError),
  });
}

function invalidToolCallResult(
  call: ToolCall,
  validation: ToolValidationResult,
  invalidSeen: Set<string>,
  threadId: string,
  deps: ToolBatchDeps,
  batch?: { callIndex: number; batchSummary: string },
): ToolResult {
  const validationError = validation.content ?? `status: error\ntool: ${call.name}\nsummary: invalid tool call`;
  const key = `${call.name}:${validationError}:${safeStableJson(call.arguments)}`;
  const repeated = invalidSeen.has(key);
  invalidSeen.add(key);
  const startedAt = Date.now();
  if (!repeated) {
    logToolCallFailure({
      call,
      threadId,
      content: validationError,
      startedAt: Date.now(),
      bridgeOnline: deps.extras.bridge?.isOnline,
      readOnly: false,
    });
    logEvent(threadId, 'tool.call.failed', {
      toolName: call.name,
      toolCallId: call.id,
      phase: 'validation',
      errorCode: validation.errorCode,
      retryable: validation.retryable,
      durationMs: 0,
      outputChars: validationError.length,
    });
  }
  const content = repeated
    ? `status: error\ntool: ${call.name}\nerror_code: repeated_invalid_tool_call\nsummary: Skipped repeated invalid tool call.\nfix: Correct the prior validation error before retrying.\nretryable: true\nprevious_error: ${validation.summary ?? validationError.replace(/\s+/g, ' ').slice(0, 300)}`
    : [
        ...(batch ? [batch.batchSummary, `call_index: ${batch.callIndex}`] : []),
        validationError,
      ].join('\n');
  return {
    toolCallId: call.id,
    toolName: call.name,
    content,
    summary: repeated ? 'Skipped repeated invalid tool call.' : validation.summary,
    ok: false,
    errorCode: repeated ? 'repeated_invalid_tool_call' : validation.errorCode,
    retryable: repeated ? true : validation.retryable,
    durationMs: Date.now() - startedAt,
    outputChars: content.length,
    ranAt: Date.now(),
  };
}

function skippedAfterInvalidToolCallResult(call: ToolCall, callIndex: number, batchSummary: string, firstInvalidIndex: number): ToolResult {
  const content = [
    batchSummary,
    `call_index: ${callIndex}`,
    `first_invalid_call_index: ${firstInvalidIndex}`,
    `status: error`,
    `tool: ${call.name}`,
    `error_code: skipped_after_invalid_tool_call`,
    `summary: This valid-looking tool call was not executed because an earlier call in the same batch failed validation.`,
    `fix: Retry this call only after correcting the earlier invalid call. Keep dependent side-effect work in separate sequential batches.`,
    `retryable: true`,
  ].join('\n');
  return {
    toolCallId: call.id,
    toolName: call.name,
    content,
    summary: 'This valid-looking tool call was not executed because an earlier call in the same batch failed validation.',
    ok: false,
    errorCode: 'skipped_after_invalid_tool_call',
    retryable: true,
    durationMs: 0,
    outputChars: content.length,
    ranAt: Date.now(),
  };
}

async function executeOneToolCall(
  call: ToolCall,
  threadId: string,
  signal: AbortSignal,
  deps: ToolBatchDeps,
): Promise<ToolResult> {
  const { extras } = deps;
  const startedAt = Date.now();
  if (signal.aborted) {
    const content = 'Cancelled.';
    return {
      toolCallId: call.id,
      toolName: call.name,
      content,
      summary: 'Cancelled.',
      ok: false,
      errorCode: 'cancelled',
      retryable: true,
      durationMs: 0,
      outputChars: content.length,
      ranAt: Date.now(),
    };
  }
  logEvent(threadId, 'tool.call.started', {
    toolName: call.name,
    toolCallId: call.id,
    readOnly: toolRegistry.isReadOnlyCall(call.name, call.arguments),
    argumentsPreview: safeJsonPreview(call.arguments),
    bridgeOnline: extras.bridge?.isOnline,
  });
  const { content, summary, artifacts, ok, errorCode, retryable } = await toolRegistry.execute(call.name, call.arguments, {
    profile: deps.profile,
    chat: deps.chat,
    notes: extras.notes,
    summary: extras.summary,
    bridge: extras.bridge,
    execStream: extras.execStream,
    imageGen: extras.imageGen,
    imageJobs: extras.imageJobs,
    localRuntime: extras.localRuntime,
    search: extras.search,
    rag: extras.rag,
    threadId,
    toolCallId: call.id,
    signal,
  });
  const durationMs = Date.now() - startedAt;
  const failed = ok === false || isToolFailureContent(call.name, content);
  if (failed) {
    logToolCallFailure({
      call,
      threadId,
      content,
      startedAt,
      bridgeOnline: extras.bridge?.isOnline,
      readOnly: toolRegistry.isReadOnlyCall(call.name, call.arguments),
    });
    logEvent(threadId, 'tool.call.failed', {
      toolName: call.name,
      toolCallId: call.id,
      phase: 'execution',
      errorCode: errorCode ?? 'tool_error',
      retryable,
      durationMs,
      outputChars: content.length,
      bridgeOnline: extras.bridge?.isOnline,
    });
  } else {
    logEvent(threadId, 'tool.call.finished', {
      toolName: call.name,
      toolCallId: call.id,
      durationMs,
      outputChars: content.length,
      bridgeOnline: extras.bridge?.isOnline,
    });
  }
  return {
    toolCallId: call.id,
    toolName: call.name,
    content,
    ...(summary ? { summary } : {}),
    ok: !failed,
    ...(failed && errorCode ? { errorCode } : {}),
    ...(failed && retryable != null ? { retryable } : {}),
    durationMs,
    outputChars: content.length,
    ranAt: Date.now(),
    ...(artifacts && artifacts.length ? { artifacts } : {}),
  };
}

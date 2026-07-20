// Projects an assistant message's tool calls/results, work notes, and bridge
// activity events into the ActivityItem timeline the UI renders. Stateless:
// ChatStore supplies the message plus live job/exec lookups via `extras`.
import type { ActivityDetail, ActivityItem, AssistantMessage, StreamActivity, ToolResult } from '../../core/types';
import { toolRegistry } from '../tools/registry';
import { isToolFailureContent } from './toolFailureLog';
import type { ToolContext } from '../tools/types';
import { messageText, messageToolCalls, messageToolResults } from '../../core/messageParts';
import { providerStreamVerb } from '../../core/statusCopy';
import { toolDisplayText } from '../tools/activityDisplay';

type ActivityExtras = Pick<ToolContext, 'imageJobs' | 'execStream'>;

export function buildActivitiesForMessage(args: {
  message: AssistantMessage;
  streaming?: boolean;
  ownerThreadId: string | undefined;
  extras: ActivityExtras | undefined;
  streamActivity?: StreamActivity;
}): ActivityItem[] {
  const { message, streaming, ownerThreadId, extras, streamActivity } = args;
  const results = messageToolResults(message);
  const items: ActivityItem[] = [];

  const usedResultIndexes = new Set<number>();
  for (const note of message.workNotes ?? []) {
    const trimmed = note.trim();
    if (!trimmed) continue;
    items.push({
      id: `${message.id}:work-note:${items.length}`,
      kind: 'thinking',
      state: 'done',
      verb: 'Thinking',
      detail: { type: 'markdown', content: trimmed },
      startedAt: message.createdAt,
      finishedAt: message.createdAt,
    });
  }
  for (const [callIndex, call] of messageToolCalls(message).entries()) {
    const resultIndex = results.findIndex((candidate, index) => !usedResultIndexes.has(index) && candidate.toolCallId === call.id);
    if (resultIndex >= 0) usedResultIndexes.add(resultIndex);
    const result = resultIndex >= 0 ? results[resultIndex] : undefined;
    const tool = toolRegistry.get(call.name);
    const artifacts = result?.artifacts;
    const imageJob = artifacts?.find(artifact => artifact.kind === 'image-job');
    const state = result
      ? stateForToolResult(result, imageJob ? extras?.imageJobs?.findById?.(imageJob.jobId)?.status : undefined)
      : 'running';
    const summary = result
      ? (tool?.ui?.summary?.({
          content: result.content,
          summary: result.summary,
          ok: result.ok,
          errorCode: result.errorCode,
          retryable: result.retryable,
          artifacts: result.artifacts,
        }) ?? result.summary)
      : undefined;
    const runningExec = !result && call.name === 'terminal' ? runningExecForCall(extras?.execStream?.jobs, ownerThreadId, call.id) : null;
    const displayText = toolDisplayText(call.arguments);
    items.push({
      id: `${call.id}:${callIndex}`,
      kind: imageJob ? 'image-job' : 'tool',
      state,
      verb: displayText ?? tool?.ui?.verb(call.arguments) ?? 'Using',
      target: displayText ? undefined : tool?.ui?.target?.(call.arguments),
      summary,
      detail: runningExec
        ? {
            type: 'terminal',
            lines: runningExec.tail,
            placeholder: runningExec.tail.length ? undefined : '(no output yet)',
          }
        : result?.content
          ? detailForToolResult(call.name, result.content)
          : undefined,
      artifacts,
      startedAt: message.createdAt,
      finishedAt: result?.ranAt,
      toolCallId: call.id,
      groupKey: imageJob || displayText ? undefined : `tool:${call.name}`,
    });
  }

  for (const event of message.activityEvents ?? []) items.push(event);

  if (streaming && streamActivity?.messageId === message.id) {
    const stalled = streamActivity.phase === 'stalled';
    items.push({
      id: `${message.id}:provider-stream`,
      kind: 'thinking',
      state: stalled ? 'failed' : 'running',
      verb: providerStreamVerb(streamActivity.phase, message.preTokenLabel, streamActivity.providerId, streamActivity.providerModelId),
      summary: stalled ? streamActivity.stallReason : undefined,
      startedAt: streamActivity.lastProviderAt,
      finishedAt: stalled ? Date.now() : undefined,
    });
  } else if (streaming && messageText(message).trim().length === 0) {
    const label = message.preTokenLabel ?? 'thinking';
    items.push({
      id: `${message.id}:pretoken`,
      kind: 'thinking',
      state: 'running',
      verb: label[0].toUpperCase() + label.slice(1),
      startedAt: message.createdAt,
    });
  }

  return items;
}

function stateForToolResult(result: ToolResult, artifactStatus?: string): ActivityItem['state'] {
  if (artifactStatus === 'cancelled') return 'cancelled';
  if (artifactStatus === 'failed') return 'failed';
  if (artifactStatus === 'pending' || artifactStatus === 'running') return 'running';
  if (result.errorCode === 'cancelled') return 'cancelled';
  if (result.ok === false || result.errorCode || isToolFailureContent(result.toolName, result.content)) return 'failed';
  return 'done';
}

function detailForToolResult(toolName: string, content: string): ActivityDetail {
  if (toolName === 'terminal' || toolName === 'git' || toolName === 'python_inline' || toolName === 'sqlite_query' || toolName === 'query_script') {
    return {
      type: 'terminal',
      lines: content.split(/\r?\n/).map(text => ({ stream: 'stdout', text })),
    };
  }
  return { type: 'markdown', content };
}

function runningExecForCall(
  jobs: NonNullable<ActivityExtras['execStream']>['jobs'] | undefined,
  threadId: string | undefined,
  toolCallId: string,
) {
  if (!jobs) return null;
  const running = Object.values(jobs).filter(job =>
    job.status === 'running'
    && job.toolCallId === toolCallId
    && (!threadId || !job.threadId || job.threadId === threadId)
  );
  if (running.length === 0) return null;
  return running.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
}

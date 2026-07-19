// Background agent-task lifecycle outside ChatStore.
// Owns schedule timers and the spawn/cancel/retry/finalize control flow;
// ChatStore remains the MobX state owner and TurnRunner host. MobX stays out
// of services — the host supplies runInAction for async mutation boundaries.
import type { ActivityItem, AssistantMessage, Thread } from '../../core/types';
import { messageText, setMessageText } from '../../core/messageParts';
import { logger } from '../diagnostics/logger';
import {
  AGENT_TASK_SLOT_RETRY_MS,
  DEFAULT_AGENT_TASK_MAX_ROUNDS,
  MAX_CONCURRENT_AGENT_TASKS,
  clampAgentTaskMaxRounds,
  clampAgentTaskStartDelayMinutes,
  normalizeAgentTaskSystemPromptBody,
} from './agentTasks';

const AGENT_TASK_SUMMARY_LIMIT = 2000;

export interface AgentTaskSpawnInput {
  title: string;
  instructions: string;
  model?: string;
  system_prompt?: string;
  max_rounds?: number;
  start_delay_minutes?: number;
}

export interface AgentTaskLifecycleHost {
  runInAction(fn: () => void): void;
  newThreadId(): string;
  newMessageId(): string;
  findThread(threadId: string): Thread | undefined;
  ensureThreadModel(threadId: string | null): Thread | null;
  resolveAgentTaskModelId(inputModelId: string | undefined, origin: Thread): string | null;
  runningAgentTaskCount(): number;
  unshiftThread(thread: Thread): void;
  schedulePersist(): void;
  interruptThread(threadId: string): void;
  clearStreamingState(threadId: string): void;
  setController(threadId: string, controller: AbortController): void;
  getController(threadId: string): AbortController | undefined;
  setThreadLastError(threadId: string, message: string | null): void;
  appendActivityEventToThread(threadId: string, event: ActivityItem): void;
  runTurn(
    threadId: string,
    signal: AbortSignal,
    isReplacingInterruptedReply: boolean,
    options?: { maxToolRounds?: number },
  ): Promise<void>;
  getThreads(): readonly Thread[];
}

export interface AgentTaskLifecycleDeps {
  host: AgentTaskLifecycleHost;
}

export class AgentTaskLifecycle {
  private readonly host: AgentTaskLifecycleHost;
  private readonly startTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(deps: AgentTaskLifecycleDeps) {
    this.host = deps.host;
  }

  spawn(
    input: AgentTaskSpawnInput,
    originThreadId: string,
  ): { ok: boolean; message: string; threadId?: string } {
    const origin = this.host.ensureThreadModel(originThreadId);
    if (!origin || origin.deletedAt != null) {
      return { ok: false, message: 'Unable to start background task: origin thread is unavailable.' };
    }
    if (origin.agentTask) {
      return { ok: false, message: 'Unable to start background task: agent tasks cannot spawn nested tasks.' };
    }

    const now = Date.now();
    const title = normalizeAgentTaskTitle(input.title);
    const instructions = input.instructions.trim();
    const modelId = this.host.resolveAgentTaskModelId(input.model, origin);
    if (!modelId) {
      return { ok: false, message: 'Unable to start background task: no local or cloud chat model is available.' };
    }
    const maxRounds = clampAgentTaskMaxRounds(input.max_rounds);
    const systemPrompt = normalizeAgentTaskSystemPromptBody(input.system_prompt);
    const delayMinutes = clampAgentTaskStartDelayMinutes(input.start_delay_minutes);
    const scheduledStartAt = delayMinutes > 0 ? now + Math.round(delayMinutes * 60_000) : undefined;
    if (!scheduledStartAt && this.host.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS) {
      return {
        ok: false,
        message: `Unable to start background task: all ${MAX_CONCURRENT_AGENT_TASKS} background task slots are in use.`,
      };
    }
    const thread: Thread = {
      id: this.host.newThreadId(),
      title: `Agent: ${title}`,
      subtitle: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      modelId,
      messages: [{
        id: this.host.newMessageId(),
        role: 'user',
        content: instructions,
        createdAt: now,
      }],
      agentTask: true,
      agentTaskOriginThreadId: origin.id,
      agentTaskStatus: scheduledStartAt ? 'scheduled' : 'running',
      ...(scheduledStartAt ? { agentTaskScheduledStartAt: scheduledStartAt } : {}),
      ...(systemPrompt ? { agentTaskSystemPrompt: systemPrompt } : {}),
      agentTaskMaxRounds: maxRounds,
      autoNamed: true,
    };
    this.host.unshiftThread(thread);
    this.host.schedulePersist();
    if (scheduledStartAt) {
      this.armScheduled(thread.id, scheduledStartAt - now);
      return {
        ok: true,
        message: `Task '${title}' scheduled to start at ${new Date(scheduledStartAt).toISOString()}.`,
        threadId: thread.id,
      };
    }
    this.startTurn(thread.id);
    return {
      ok: true,
      message: `Task '${title}' started in background.`,
      threadId: thread.id,
    };
  }

  cancel(threadId: string): boolean {
    const thread = this.host.findThread(threadId);
    if (
      !thread
      || thread.deletedAt != null
      || thread.agentTask !== true
      || (thread.agentTaskStatus !== 'scheduled' && thread.agentTaskStatus !== 'running')
    ) return false;
    const originThreadId = thread.agentTaskOriginThreadId;
    if (!originThreadId) return false;
    const title = displayAgentTaskTitle(thread.title);
    this.cancelScheduled(threadId);
    this.host.interruptThread(threadId);
    this.finalize(threadId, originThreadId, title, 'interrupted');
    return true;
  }

  retry(threadId: string): boolean {
    const thread = this.host.findThread(threadId);
    if (
      !thread
      || thread.deletedAt != null
      || thread.agentTask !== true
      || (thread.agentTaskStatus !== 'error' && thread.agentTaskStatus !== 'interrupted')
      || this.host.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS
    ) return false;
    const initialPrompt = thread.messages.find(message => message.role === 'user');
    if (!initialPrompt) return false;
    this.host.runInAction(() => {
      thread.messages = [initialPrompt];
      thread.updatedAt = Date.now();
      this.host.setThreadLastError(thread.id, null);
      const origin = this.host.findThread(thread.agentTaskOriginThreadId ?? '');
      if (origin) {
        for (const message of origin.messages) {
          if (message.role !== 'assistant' || !message.activityEvents) continue;
          message.activityEvents = message.activityEvents.filter(event =>
            event.kind !== 'agent-task' || event.linkThreadId !== thread.id
          );
        }
      }
    });
    this.startTurn(thread.id);
    this.host.schedulePersist();
    return true;
  }

  armScheduled(threadId: string, delayMs: number): void {
    this.cancelScheduled(threadId);
    const timer = setTimeout(() => {
      this.startTimers.delete(threadId);
      this.host.runInAction(() => this.tryStartScheduled(threadId));
    }, Math.max(0, delayMs));
    this.startTimers.set(threadId, timer);
  }

  cancelScheduled(threadId: string): void {
    const timer = this.startTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(threadId);
  }

  clearAllTimers(): void {
    for (const timer of this.startTimers.values()) clearTimeout(timer);
    this.startTimers.clear();
  }

  reconcileOnBoot(): void {
    for (const thread of this.host.getThreads()) {
      if (thread.agentTask !== true) continue;
      if (thread.agentTaskStatus === 'scheduled') {
        const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
        this.armScheduled(thread.id, Math.max(0, dueAt - Date.now()));
        continue;
      }
      if (thread.agentTaskStatus !== 'running') continue;
      thread.agentTaskStatus = 'interrupted';
      thread.updatedAt = Date.now();
      const lastAssistant = findLastAssistant(thread);
      if (lastAssistant) {
        const partial = messageText(lastAssistant).trim();
        setMessageText(lastAssistant, partial ? `${messageText(lastAssistant)}\n\n*[interrupted]*` : '*[no response - background task interrupted]*');
      }
      if (thread.agentTaskOriginThreadId) {
        this.host.appendActivityEventToThread(thread.agentTaskOriginThreadId, {
          id: `agent-task-${thread.id}-boot-interrupted`,
          kind: 'agent-task',
          state: 'cancelled',
          verb: `Background task '${displayAgentTaskTitle(thread.title)}' finished`,
          target: 'see thread',
          summary: 'Interrupted because the app closed or reloaded while the task was running.',
          detail: { type: 'markdown', content: 'Interrupted because the app closed or reloaded while the task was running.' },
          startedAt: thread.createdAt,
          finishedAt: Date.now(),
          linkThreadId: thread.id,
        });
      }
    }
  }

  private startTurn(threadId: string): void {
    const thread = this.host.ensureThreadModel(threadId);
    if (!thread || !thread.agentTask || thread.messages.length === 0) return;
    const originThreadId = thread.agentTaskOriginThreadId;
    if (!originThreadId) return;
    const title = displayAgentTaskTitle(thread.title);
    this.cancelScheduled(thread.id);
    thread.agentTaskStatus = 'running';
    delete thread.agentTaskScheduledStartAt;
    thread.updatedAt = Date.now();
    const controller = new AbortController();
    this.host.setController(thread.id, controller);
    this.host.runTurn(thread.id, controller.signal, false, {
      maxToolRounds: clampAgentTaskMaxRounds(thread.agentTaskMaxRounds ?? DEFAULT_AGENT_TASK_MAX_ROUNDS),
    })
      .then(() => {
        this.finalize(thread.id, originThreadId, title, controller.signal.aborted ? 'interrupted' : 'done');
      })
      .catch(err => this.host.runInAction(() => {
        logger.error('chat', 'agent task run failed', { threadId: thread.id, err });
        this.host.setThreadLastError(thread.id, (err as Error).message);
        if (this.host.getController(thread.id) === controller) {
          this.host.clearStreamingState(thread.id);
        }
        this.finalize(thread.id, originThreadId, title, 'error', (err as Error).message);
      }));
  }

  private tryStartScheduled(threadId: string): void {
    const thread = this.host.findThread(threadId);
    if (!thread || thread.deletedAt != null || thread.agentTask !== true || thread.agentTaskStatus !== 'scheduled') return;
    const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
    const remainingMs = dueAt - Date.now();
    if (remainingMs > 0) {
      this.armScheduled(thread.id, remainingMs);
      return;
    }
    if (this.host.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS) {
      this.armScheduled(thread.id, AGENT_TASK_SLOT_RETRY_MS);
      return;
    }
    this.startTurn(thread.id);
    this.host.schedulePersist();
  }

  private startDueScheduled(): void {
    let started = false;
    for (const thread of this.host.getThreads()) {
      if (thread.agentTask !== true || thread.agentTaskStatus !== 'scheduled' || thread.deletedAt != null) continue;
      const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
      if (dueAt <= Date.now() && this.host.runningAgentTaskCount() < MAX_CONCURRENT_AGENT_TASKS) {
        this.startTurn(thread.id);
        started = true;
      }
    }
    if (started) this.host.schedulePersist();
  }

  private finalize(
    threadId: string,
    originThreadId: string,
    title: string,
    status: NonNullable<Thread['agentTaskStatus']>,
    errorMessage?: string,
  ): void {
    this.host.runInAction(() => {
      const thread = this.host.findThread(threadId);
      if (
        !thread
        || thread.agentTask !== true
        || (thread.agentTaskStatus !== 'running' && thread.agentTaskStatus !== 'scheduled')
      ) return;
      thread.agentTaskStatus = status;
      thread.updatedAt = Date.now();
      const summary = summarizeAgentTaskThread(thread, status, errorMessage);
      this.host.appendActivityEventToThread(originThreadId, {
        id: `agent-task-${threadId}-${Date.now()}`,
        kind: 'agent-task',
        state: status === 'error' ? 'failed' : status === 'interrupted' ? 'cancelled' : 'done',
        verb: `Background task '${title}' finished`,
        target: 'see thread',
        summary,
        detail: summary ? { type: 'markdown', content: summary } : undefined,
        startedAt: thread.createdAt,
        finishedAt: Date.now(),
        linkThreadId: threadId,
      });
      this.host.schedulePersist();
      this.startDueScheduled();
    });
  }
}

export function normalizeAgentTaskTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Background task';
}

export function displayAgentTaskTitle(title: string): string {
  return title.startsWith('Agent: ') ? title.slice('Agent: '.length) : title;
}

function findLastAssistant(thread: Thread): AssistantMessage | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

function summarizeAgentTaskThread(
  thread: Thread,
  status: NonNullable<Thread['agentTaskStatus']>,
  errorMessage?: string,
): string {
  const assistant = findLastAssistant(thread);
  let summary = (assistant ? messageText(assistant).trim() : '') || errorMessage || 'Background task finished without a final summary.';
  if (status === 'interrupted') summary = summary.includes('interrupted') ? summary : `${summary}\n\n[interrupted]`;
  if (status === 'error' && errorMessage && !summary.includes(errorMessage)) summary = `${summary}\n\n${errorMessage}`;
  if (summary.includes(`Stopped after ${DEFAULT_AGENT_TASK_MAX_ROUNDS} tool rounds`)) {
    summary = `[capped]\n${summary}`;
  }
  return summary.length > AGENT_TASK_SUMMARY_LIMIT
    ? `${summary.slice(0, AGENT_TASK_SUMMARY_LIMIT).trimEnd()}\n\n[summary truncated]`
    : summary;
}

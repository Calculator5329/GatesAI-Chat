// Observable strangler facade over existing background-work owners.
// ImageJobStore and ChatStore remain the runners and persistence authorities;
// TaskStore projects their state into one generic ledger for shared UI.
import { makeAutoObservable } from 'mobx';
import type { StreamActivity, Thread } from '../core/types';
import { messageText } from '../core/messageParts';
import { threadLlmSpendUsd } from '../core/threadSelectors';
import type { CompletedJob, ImageJob } from '../services/image/jobs/types';
import type { TaskStatus, TaskView } from '../services/tasks/types';
import { DEFAULT_AGENT_TASK_MAX_ROUNDS } from '../services/chat/agentTasks';

export type { TaskKind, TaskProgress, TaskStatus, TaskView } from '../services/tasks/types';

export interface TaskImageJobsFacade {
  queue: ImageJob[];
  active: ImageJob | null;
  history: CompletedJob[];
  cancel(jobId: string): void;
  retry(jobId: string): void;
}

export interface TaskAgentThreadsFacade {
  readonly visibleAgentTaskThreads: Thread[];
  readonly streamActivityByThread: Record<string, StreamActivity>;
  readonly lastErrorByThread: Record<string, string>;
  cancelAgentTask(threadId: string): boolean;
  retryAgentTask(threadId: string): boolean;
}

export class TaskStore {
  private readonly imageJobs: TaskImageJobsFacade;
  private readonly chat: TaskAgentThreadsFacade;
  private readonly cancelledAgentIds = new Set<string>();

  constructor(imageJobs: TaskImageJobsFacade, chat: TaskAgentThreadsFacade) {
    this.imageJobs = imageJobs;
    this.chat = chat;
    makeAutoObservable<this, 'imageJobs' | 'chat'>(this, {
      imageJobs: false,
      chat: false,
    });
  }

  /** Unified live + historical ledger, newest task first within each state. */
  get tasks(): TaskView[] {
    const images = [
      ...this.imageJobs.queue,
      ...(this.imageJobs.active ? [this.imageJobs.active] : []),
      ...this.imageJobs.history,
    ].map(job => this.imageTask(job));
    const agents = this.chat.visibleAgentTaskThreads.map(thread => this.agentTask(thread));
    return [...images, ...agents].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }

  get pending(): TaskView[] {
    return this.tasks.filter(task => task.status === 'pending');
  }

  get running(): TaskView[] {
    return this.tasks.filter(task => task.status === 'running');
  }

  get history(): TaskView[] {
    return this.tasks.filter(task => task.status !== 'pending' && task.status !== 'running');
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.find(candidate => candidate.id === taskId);
    if (!task || (task.status !== 'pending' && task.status !== 'running')) return false;
    if (task.kind === 'image') {
      this.imageJobs.cancel(taskId);
      return true;
    }
    if (task.kind === 'agent') {
      this.cancelledAgentIds.add(taskId);
      const cancelled = this.chat.cancelAgentTask(taskId);
      if (!cancelled) this.cancelledAgentIds.delete(taskId);
      return cancelled;
    }
    return false;
  }

  retry(taskId: string): boolean {
    const task = this.tasks.find(candidate => candidate.id === taskId);
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return false;
    if (task.kind === 'image') {
      this.imageJobs.retry(taskId);
      return true;
    }
    if (task.kind === 'agent') {
      const retried = this.chat.retryAgentTask(taskId);
      if (retried) this.cancelledAgentIds.delete(taskId);
      return retried;
    }
    return false;
  }

  private imageTask(job: ImageJob | CompletedJob): TaskView {
    return {
      id: job.id,
      kind: 'image',
      title: compactTitle(job.prompt, 'Image render'),
      threadId: job.threadId,
      status: job.status,
      ...(job.progress ? { progress: { ...job.progress } } : {}),
      results: [...job.results],
      ...(job.error ? { error: job.error } : {}),
      createdAt: job.createdAt,
      ...(job.startedAt != null ? { startedAt: job.startedAt } : {}),
      ...(job.completedAt != null ? { completedAt: job.completedAt } : {}),
      ...(job.costUsd != null ? { costUsd: job.costUsd } : {}),
    };
  }

  private agentTask(thread: Thread): TaskView {
    const status = agentTaskStatus(thread, this.cancelledAgentIds.has(thread.id));
    const activity = this.chat.streamActivityByThread[thread.id];
    const maxRounds = thread.agentTaskMaxRounds ?? DEFAULT_AGENT_TASK_MAX_ROUNDS;
    const round = Math.min(maxRounds, Math.max(1, (activity?.round ?? 0) + 1));
    const finalText = lastAssistantText(thread);
    const recordedError = this.chat.lastErrorByThread[thread.id];
    const interruptedError = thread.agentTaskStatus === 'interrupted' && status === 'failed'
      ? 'The app closed or the task was interrupted before it completed. Retry to run it again.'
      : undefined;
    const costUsd = threadLlmSpendUsd(thread);
    return {
      id: thread.id,
      kind: 'agent',
      title: compactTitle(stripAgentPrefix(thread.title), 'Background task'),
      threadId: thread.id,
      status,
      ...(status === 'running' ? {
        progress: { value: round, max: maxRounds, label: `Round ${round} of ${maxRounds}` },
      } : {}),
      results: finalText ? [finalText] : [],
      ...(recordedError || interruptedError ? { error: recordedError ?? interruptedError } : {}),
      createdAt: thread.createdAt,
      ...(thread.agentTaskStatus !== 'scheduled' ? { startedAt: thread.createdAt } : {}),
      ...(status !== 'pending' && status !== 'running' ? { completedAt: thread.updatedAt } : {}),
      ...(costUsd > 0 ? { costUsd } : {}),
    };
  }
}

function agentTaskStatus(thread: Thread, cancelled: boolean): TaskStatus {
  if (thread.agentTaskStatus === 'scheduled') return 'pending';
  if (thread.agentTaskStatus === 'running') return 'running';
  if (thread.agentTaskStatus === 'done') return 'done';
  if (thread.agentTaskStatus === 'interrupted') return cancelled ? 'cancelled' : 'failed';
  return 'failed';
}

function stripAgentPrefix(title: string): string {
  return title.startsWith('Agent: ') ? title.slice('Agent: '.length) : title;
}

function compactTitle(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 100) : fallback;
}

function lastAssistantText(thread: Thread): string {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === 'assistant') return messageText(message).trim();
  }
  return '';
}

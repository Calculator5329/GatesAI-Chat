// Observable strangler facade over existing background-work owners.
// ImageJobStore and ChatStore remain the runners and persistence authorities;
// TaskStore projects their state into one generic ledger for shared UI.
import { makeAutoObservable, observable } from 'mobx';
import type { StreamActivity, Thread } from '../core/types';
import { messageText } from '../core/messageParts';
import { threadLlmSpendUsd } from '../core/threadSelectors';
import type { CompletedJob, ImageJob } from '../services/image/jobs/types';
import type { TaskStatus, TaskView } from '../services/tasks/types';
import { DEFAULT_AGENT_TASK_MAX_ROUNDS } from '../services/chat/agentTasks';
import { createAgentTaskAttempt, createAgentTaskSpec, type AgentTaskAttempt } from '../services/tasks/agentTaskSpec';
import { fifoPending, MAX_CONCURRENT_LEDGER_AGENT_TASKS, pendingReason, remainingTaskBudget, type AgentTaskLedgerEntry } from '../services/tasks/budgets';

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
  private ledgerEntries: AgentTaskLedgerEntry[] = [];
  private readonly imageJobs: TaskImageJobsFacade;
  private readonly chat: TaskAgentThreadsFacade;
  private readonly cancelledAgentIds = new Set<string>();
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private enqueueSequence = 0;

  constructor(imageJobs: TaskImageJobsFacade, chat: TaskAgentThreadsFacade, options: {
    clock?: () => number;
    idFactory?: () => string;
  } = {}) {
    this.imageJobs = imageJobs;
    this.chat = chat;
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    makeAutoObservable<this, 'imageJobs' | 'chat' | 'clock' | 'idFactory' | 'ledgerEntries' | 'enqueueSequence'>(this, {
      ledgerEntries: observable.shallow,
      imageJobs: false,
      chat: false,
      clock: false,
      idFactory: false,
      enqueueSequence: false,
    });
  }

  get ledgerPending(): AgentTaskLedgerEntry[] {
    const activeCount = this.ledgerRunning.length + this.existingRunningAgentTasks;
    const availableSlots = Math.max(0, MAX_CONCURRENT_LEDGER_AGENT_TASKS - activeCount);
    return fifoPending(this.ledgerEntries).map((entry, index) => freezeLedgerEntry({
      ...entry,
      pending_reason: index < availableSlots ? pendingReason(activeCount) : 'waiting_for_slot',
    }));
  }

  get ledgerRunning(): AgentTaskLedgerEntry[] {
    return this.ledgerEntries.filter(entry => entry.state === 'running').map(freezeLedgerEntry);
  }

  get agentLedger(): readonly Readonly<AgentTaskLedgerEntry>[] {
    return Object.freeze(this.ledgerEntries.map(freezeLedgerEntry));
  }

  enqueueAgentTask(input: Omit<Parameters<typeof createAgentTaskSpec>[0], 'id' | 'created_at'>): AgentTaskLedgerEntry {
    const spec = createAgentTaskSpec({ ...input, id: this.idFactory(), created_at: this.clock() });
    const entry: AgentTaskLedgerEntry = {
      spec,
      enqueue_sequence: ++this.enqueueSequence,
      state: 'pending',
      pending_reason: 'ready',
      attempts: [],
    };
    this.ledgerEntries.push(entry);
    return this.agentLedger.at(-1) as AgentTaskLedgerEntry;
  }

  startNextAgentTask(): AgentTaskAttempt | null {
    const activeCount = this.ledgerRunning.length + this.existingRunningAgentTasks;
    if (activeCount >= MAX_CONCURRENT_LEDGER_AGENT_TASKS) return null;
    const entry = fifoPending(this.ledgerEntries)[0];
    if (!entry) return null;
    const attempt = createAgentTaskAttempt(entry.spec, entry.attempts.length + 1, this.clock());
    const index = this.ledgerEntries.indexOf(entry);
    this.ledgerEntries[index] = { ...entry, attempts: [...entry.attempts, attempt], state: 'running', pending_reason: null };
    return Object.freeze({ ...attempt });
  }

  finishAgentAttempt(taskId: string, input: {
    state: Extract<AgentTaskLedgerEntry['state'], 'done' | 'failed' | 'cancelled' | 'interrupted'>;
    actual_cost_usd: number;
    used_tokens: number;
    result_ref?: string;
    stop_reason?: string;
  }): boolean {
    const entry = this.ledgerEntries.find(item => item.spec.id === taskId && item.state === 'running');
    const attempt = entry?.attempts.at(-1);
    if (!entry || !attempt || attempt.state !== 'running') return false;
    if (!Number.isFinite(input.actual_cost_usd) || input.actual_cost_usd < 0
      || !Number.isSafeInteger(input.used_tokens) || input.used_tokens < 0
      || (input.result_ref !== undefined && !boundedLedgerText(input.result_ref, 500))
      || (input.stop_reason !== undefined && !boundedLedgerText(input.stop_reason, 500))) return false;
    const remaining = remainingTaskBudget({ ...entry, attempts: entry.attempts.slice(0, -1) });
    const budgetExceeded = input.actual_cost_usd > remaining.cost_usd || input.used_tokens > remaining.tokens;
    const completedAttempt: AgentTaskAttempt = {
      ...attempt,
      state: budgetExceeded ? 'failed' : input.state,
      actual_cost_usd: input.actual_cost_usd,
      used_tokens: input.used_tokens,
      completed_at: this.clock(),
      ...(input.result_ref ? { result_ref: input.result_ref } : {}),
      ...(budgetExceeded
        ? { stop_reason: 'budget_exceeded' }
        : input.stop_reason ? { stop_reason: input.stop_reason } : {}),
    };
    const index = this.ledgerEntries.indexOf(entry);
    this.ledgerEntries[index] = {
      ...entry,
      state: budgetExceeded ? 'failed' : input.state,
      attempts: [...entry.attempts.slice(0, -1), completedAttempt],
    };
    return true;
  }

  retryLedgerTask(taskId: string): boolean {
    const entry = this.ledgerEntries.find(item => item.spec.id === taskId);
    if (!entry || !['failed', 'cancelled', 'interrupted'].includes(entry.state)) return false;
    const index = this.ledgerEntries.indexOf(entry);
    this.ledgerEntries[index] = { ...entry, state: 'pending', pending_reason: 'ready' };
    return true;
  }

  cancelLedgerTask(taskId: string): boolean {
    const entry = this.ledgerEntries.find(item => item.spec.id === taskId);
    if (!entry || entry.state !== 'pending') return false;
    const index = this.ledgerEntries.indexOf(entry);
    this.ledgerEntries[index] = { ...entry, state: 'cancelled', pending_reason: null };
    return true;
  }

  private get existingRunningAgentTasks(): number {
    return this.chat.visibleAgentTaskThreads.filter(thread => thread.agentTaskStatus === 'running').length;
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

function boundedLedgerText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && value.trim() === value;
}

function freezeLedgerEntry(entry: AgentTaskLedgerEntry): AgentTaskLedgerEntry {
  return Object.freeze({
    ...entry,
    attempts: Object.freeze(entry.attempts.map(attempt => Object.freeze({ ...attempt }))) as AgentTaskAttempt[],
  });
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

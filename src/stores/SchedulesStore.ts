// Owns observable scheduled automation state and the app-open scheduler loop.
// Called by RootStore, tools, and menu UI; fires only through ChatStore.spawnTask.
import { autorun, makeAutoObservable, toJS } from 'mobx';
import type { Thread } from '../core/types';
import {
  type Schedule,
  type ScheduleInput,
  type SchedulesSnapshot,
  naturalNextScheduleRunAt,
  nextFutureScheduleRunAt,
  nextScheduleRunAfter,
  normalizeScheduleCadence,
} from '../core/schedules';
import { MAX_CONCURRENT_AGENT_TASKS } from '../services/chat/agentTasks';
import { schedulesPersistence, type createSchedulesPersistenceProvider } from '../services/schedulesStorage';

export const SCHEDULE_TICK_MS = 30_000;
export const SCHEDULED_TASK_TITLE_PREFIX = 'Scheduled: ';

export interface ScheduleClock {
  now(): number;
}

export interface SchedulesChatFacade {
  readonly threads: Thread[];
  readonly activeThreadId: string | null;
  createThread(): string;
  runningAgentTaskCount(): number;
  isThreadStreaming?(threadId: string): boolean;
  spawnTask(input: {
    title: string;
    instructions: string;
    model?: string;
  }, originThreadId: string): { ok: boolean; message: string; threadId?: string };
}

type SchedulesPersistence = ReturnType<typeof createSchedulesPersistenceProvider>;

function newId(): string {
  return `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class SchedulesStore {
  schedules: Schedule[] = [];

  private readonly chat: SchedulesChatFacade;
  private readonly persistence: SchedulesPersistence;
  private readonly clock: ScheduleClock;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistDisposer: (() => void) | null = null;
  private nextDueById = new Map<string, number>();

  constructor(
    chat: SchedulesChatFacade,
    options: {
      persistence?: SchedulesPersistence;
      clock?: ScheduleClock;
      autoPersist?: boolean;
    } = {},
  ) {
    this.chat = chat;
    this.persistence = options.persistence ?? schedulesPersistence;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.schedules = this.persistence.load().schedules;
    makeAutoObservable<this, 'chat' | 'persistence' | 'clock' | 'timer' | 'persistDisposer'>(this, {
      chat: false,
      persistence: false,
      clock: false,
      timer: false,
      persistDisposer: false,
    });
    if (options.autoPersist ?? true) {
      this.persistDisposer = autorun(() => this.persistence.save(toJS(this.snapshot)));
    }
  }

  get snapshot(): SchedulesSnapshot {
    return { schedules: this.schedules };
  }

  get count(): number {
    return this.schedules.length;
  }

  get sorted(): Schedule[] {
    return [...this.schedules].sort((a, b) => a.createdAt - b.createdAt);
  }

  start(): void {
    if (this.timer) return;
    this.initializeNextDueOnBoot();
    this.tick();
    this.timer = setInterval(() => this.tick(), SCHEDULE_TICK_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persistDisposer?.();
    this.persistDisposer = null;
  }

  findById(id: string): Schedule | null {
    return this.schedules.find(schedule => schedule.id === id) ?? null;
  }

  nextRunAt(id: string): number | null {
    const schedule = this.findById(id);
    if (!schedule) return null;
    return this.nextDueById.get(id) ?? nextFutureScheduleRunAt(schedule, this.clock.now());
  }

  create(input: ScheduleInput): Schedule {
    const now = this.clock.now();
    const schedule: Schedule = {
      id: newId(),
      title: normalizeTitle(input.title),
      instructions: normalizeInstructions(input.instructions),
      ...(input.model ? { model: input.model } : {}),
      cadence: normalizeScheduleCadence(input.cadence),
      enabled: input.enabled ?? true,
      catchUp: input.catchUp === true,
      createdAt: now,
    };
    this.schedules.unshift(schedule);
    this.nextDueById.set(schedule.id, nextScheduleRunAfter(schedule.cadence, now));
    return schedule;
  }

  update(id: string, patch: Partial<ScheduleInput>): Schedule | null {
    const schedule = this.findById(id);
    if (!schedule) return null;
    if (patch.title !== undefined) schedule.title = normalizeTitle(patch.title);
    if (patch.instructions !== undefined) schedule.instructions = normalizeInstructions(patch.instructions);
    if (patch.model !== undefined) {
      if (patch.model) schedule.model = patch.model;
      else delete schedule.model;
    }
    if (patch.cadence !== undefined) schedule.cadence = normalizeScheduleCadence(patch.cadence);
    if (patch.enabled !== undefined) schedule.enabled = patch.enabled;
    if (patch.catchUp !== undefined) schedule.catchUp = patch.catchUp;
    this.nextDueById.set(schedule.id, nextFutureScheduleRunAt(schedule, this.clock.now()));
    return schedule;
  }

  setEnabled(id: string, enabled: boolean): Schedule | null {
    return this.update(id, { enabled });
  }

  remove(id: string): Schedule | null {
    const index = this.schedules.findIndex(schedule => schedule.id === id);
    if (index < 0) return null;
    const [removed] = this.schedules.splice(index, 1);
    this.nextDueById.delete(id);
    return removed;
  }

  runNow(id: string): { ok: boolean; message: string; threadId?: string } {
    const schedule = this.findById(id);
    if (!schedule) return { ok: false, message: `No schedule with id "${id}".` };
    return this.fireSchedule(schedule, this.clock.now(), { manual: true });
  }

  tick(): void {
    const now = this.clock.now();
    for (const schedule of this.sorted) {
      if (!schedule.enabled) continue;
      const dueAt = this.nextDueById.get(schedule.id) ?? naturalNextScheduleRunAt(schedule);
      if (dueAt > now) continue;
      this.fireSchedule(schedule, now, { manual: false });
    }
  }

  private initializeNextDueOnBoot(): void {
    const now = this.clock.now();
    this.nextDueById.clear();
    for (const schedule of this.schedules) {
      const naturalDueAt = naturalNextScheduleRunAt(schedule);
      if (schedule.enabled && schedule.catchUp && naturalDueAt <= now) {
        this.nextDueById.set(schedule.id, naturalDueAt);
      } else {
        this.nextDueById.set(schedule.id, nextFutureScheduleRunAt(schedule, now));
      }
    }
  }

  private fireSchedule(
    schedule: Schedule,
    now: number,
    options: { manual: boolean },
  ): { ok: boolean; message: string; threadId?: string } {
    if (this.hasRunningResult(schedule)) {
      return { ok: false, message: `Schedule "${schedule.title}" is already running.` };
    }
    if (this.chat.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS) {
      return {
        ok: false,
        message: `Schedule "${schedule.title}" is waiting for a background task slot.`,
      };
    }

    const originThreadId = this.originThreadId();
    const result = this.chat.spawnTask({
      title: `${SCHEDULED_TASK_TITLE_PREFIX}${schedule.title}`,
      instructions: schedule.instructions,
      ...(schedule.model ? { model: schedule.model } : {}),
    }, originThreadId);
    if (!result.ok || !result.threadId) return result;

    schedule.lastRunAt = now;
    schedule.lastResultThreadId = result.threadId;
    this.nextDueById.set(schedule.id, nextScheduleRunAfter(schedule.cadence, now));
    return {
      ok: true,
      message: options.manual
        ? `Started schedule "${schedule.title}".`
        : `Fired schedule "${schedule.title}".`,
      threadId: result.threadId,
    };
  }

  private hasRunningResult(schedule: Schedule): boolean {
    if (!schedule.lastResultThreadId) return false;
    const thread = this.chat.threads.find(item => item.id === schedule.lastResultThreadId);
    if (!thread || thread.deletedAt != null || thread.agentTask !== true) return false;
    return thread.agentTaskStatus === 'running'
      || thread.agentTaskStatus === 'scheduled'
      || this.chat.isThreadStreaming?.(thread.id) === true;
  }

  private originThreadId(): string {
    const active = this.chat.threads.find(thread =>
      thread.id === this.chat.activeThreadId
      && thread.deletedAt == null
      && thread.agentTask !== true
    );
    if (active) return active.id;
    const existing = this.chat.threads.find(thread => thread.deletedAt == null && thread.agentTask !== true);
    return existing?.id ?? this.chat.createThread();
  }
}

function normalizeTitle(value: string): string {
  return value.trim().slice(0, 120) || 'Untitled schedule';
}

function normalizeInstructions(value: string): string {
  return value.trim().slice(0, 20_000);
}

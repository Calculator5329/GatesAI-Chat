// Defines shared schedule domain contracts and pure timing helpers.
// Called by SchedulesStore, tools, UI, and tests; depends only on local Date behavior.
export const SCHEDULE_INTERVAL_HOURS = [1, 2, 4, 8, 12, 24] as const;
export type ScheduleIntervalHours = typeof SCHEDULE_INTERVAL_HOURS[number];

export type ScheduleCadence =
  | { kind: 'interval'; hours: ScheduleIntervalHours }
  | { kind: 'daily'; hour: number; minute: number };

export interface Schedule {
  id: string;
  title: string;
  instructions: string;
  model?: string;
  cadence: ScheduleCadence;
  enabled: boolean;
  catchUp: boolean;
  lastRunAt?: number;
  lastResultThreadId?: string;
  createdAt: number;
}

export interface SchedulesSnapshot {
  schedules: Schedule[];
}

export interface ScheduleInput {
  title: string;
  instructions: string;
  model?: string;
  cadence: ScheduleCadence;
  enabled?: boolean;
  catchUp?: boolean;
}

export const DEFAULT_SCHEDULE_CADENCE: ScheduleCadence = { kind: 'interval', hours: 24 };

export function isScheduleIntervalHours(value: unknown): value is ScheduleIntervalHours {
  return typeof value === 'number' && SCHEDULE_INTERVAL_HOURS.includes(value as ScheduleIntervalHours);
}

export function normalizeScheduleCadence(value: unknown): ScheduleCadence {
  if (!value || typeof value !== 'object') return DEFAULT_SCHEDULE_CADENCE;
  const raw = value as Partial<ScheduleCadence>;
  if (raw.kind === 'interval') {
    const hours = isScheduleIntervalHours(raw.hours) ? raw.hours : 24;
    return { kind: 'interval', hours };
  }
  if (raw.kind === 'daily') {
    return {
      kind: 'daily',
      hour: clampInt(raw.hour, 0, 23, 9),
      minute: clampInt(raw.minute, 0, 59, 0),
    };
  }
  return DEFAULT_SCHEDULE_CADENCE;
}

export function nextScheduleRunAfter(cadence: ScheduleCadence, afterMs: number): number {
  const after = new Date(afterMs);
  if (cadence.kind === 'interval') {
    const next = new Date(afterMs);
    next.setHours(next.getHours() + cadence.hours);
    return next.getTime();
  }

  const next = new Date(
    after.getFullYear(),
    after.getMonth(),
    after.getDate(),
    cadence.hour,
    cadence.minute,
    0,
    0,
  );
  if (next.getTime() <= afterMs) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function firstScheduleRunAtOrAfter(cadence: ScheduleCadence, baseMs: number, nowMs: number): number {
  let dueAt = nextScheduleRunAfter(cadence, baseMs);
  while (dueAt <= nowMs) dueAt = nextScheduleRunAfter(cadence, dueAt);
  return dueAt;
}

export function naturalNextScheduleRunAt(schedule: Schedule): number {
  const base = schedule.lastRunAt ?? schedule.createdAt;
  return nextScheduleRunAfter(schedule.cadence, base);
}

export function nextFutureScheduleRunAt(schedule: Schedule, nowMs: number): number {
  return firstScheduleRunAtOrAfter(schedule.cadence, schedule.lastRunAt ?? schedule.createdAt, nowMs);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, numeric));
}

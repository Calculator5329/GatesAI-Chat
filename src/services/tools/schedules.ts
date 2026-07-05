// Defines the scheduled automation tool contract and model-facing formatting.
// Called by ChatStore tool rounds via the registry; delegates execution to SchedulesStore.
import type { Schedule, ScheduleCadence, ScheduleIntervalHours } from '../../core/schedules';
import { SCHEDULE_INTERVAL_HOURS } from '../../core/schedules';
import type { Tool } from './types';

type ScheduleAction = 'schedule_task' | 'list_schedules' | 'delete_schedule' | 'run_now';

export const schedulesTool: Tool = {
  def: {
    name: 'schedules',
    description: [
      'Manage recurring agent-task schedules for the user. These schedules only run while GatesAI is open; they do not run when the app is closed. The user can manage them in the Agent menu under Schedules.',
      '',
      '`schedule_task` creates a recurring automation and shows a visible tool activity in the chat. Requires `title`, `instructions`, and exactly one cadence: `cadence_hours` (1, 2, 4, 8, 12, or 24) or `daily_at` ("HH:MM" local time). Optional `model` is a GatesAI model id. Optional `catch_up` fires once on the next app boot if a run was missed while GatesAI was closed.',
      '`list_schedules` lists existing schedules with next run times and last result thread ids.',
      '`delete_schedule` removes one schedule by `id`.',
      '`run_now` starts one schedule immediately if a background task slot is available.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schedule_task', 'list_schedules', 'delete_schedule', 'run_now'] },
        id: { type: 'string', description: 'Schedule id for delete_schedule or run_now.' },
        title: { type: 'string', description: 'Short schedule title for schedule_task.' },
        instructions: { type: 'string', description: 'Complete instructions for the recurring background agent.' },
        cadence_hours: { type: 'number', description: 'Interval cadence in hours: 1, 2, 4, 8, 12, or 24.' },
        daily_at: { type: 'string', description: 'Daily local wall-clock time in HH:MM, 24-hour format.' },
        model: { type: 'string', description: 'Optional GatesAI model id.' },
        catch_up: { type: 'boolean', description: 'If true, fire once on boot when a run was missed while GatesAI was closed.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'schedules',
    risk: 'medium',
    isReadOnly: args => args.action === 'list_schedules',
    hasSideEffects: args => args.action !== 'list_schedules',
    resultPolicy: { maxChars: 6_000, summarizeLargeOutput: true },
    validate: args => validateSchedulesArgs(args),
  },
  ui: {
    verb: args => {
      const action = String(args.action ?? '');
      if (action === 'schedule_task') return 'Created schedule';
      if (action === 'delete_schedule') return 'Deleted schedule';
      if (action === 'run_now') return 'Ran schedule';
      return 'Listed schedules';
    },
    target: args => typeof args.title === 'string'
      ? args.title
      : typeof args.id === 'string'
        ? args.id
        : undefined,
    summary: result => result.summary,
  },
  async execute(args, ctx) {
    if (!ctx.schedules) return 'Error: schedules store unavailable in this context.';
    const action = typeof args.action === 'string' ? args.action as ScheduleAction : '';
    switch (action) {
      case 'schedule_task': return doCreate(args, ctx);
      case 'list_schedules': return doList(ctx);
      case 'delete_schedule': return doDelete(args, ctx);
      case 'run_now': return doRunNow(args, ctx);
      default: return `Error: unknown action "${action}". Valid: schedule_task, list_schedules, delete_schedule, run_now.`;
    }
  },
};

function validateSchedulesArgs(args: Record<string, unknown>) {
  const action = typeof args.action === 'string' ? args.action : '';
  if (action === 'schedule_task') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : '';
    if (!title) {
      return {
        errorCode: 'missing_required_argument',
        summary: '`title` is required for schedules.schedule_task.',
        fix: 'Retry with a short schedule title.',
        retryable: true,
      };
    }
    if (!instructions) {
      return {
        errorCode: 'missing_required_argument',
        summary: '`instructions` is required for schedules.schedule_task.',
        fix: 'Retry with complete recurring task instructions.',
        retryable: true,
      };
    }
    const hasHours = args.cadence_hours != null;
    const hasDaily = args.daily_at != null;
    if (hasHours === hasDaily) {
      return {
        errorCode: 'invalid_cadence',
        summary: 'Provide exactly one of `cadence_hours` or `daily_at` for schedules.schedule_task.',
        fix: 'Use `cadence_hours` for interval schedules or `daily_at` for a daily local time.',
        retryable: true,
      };
    }
    if (hasHours && !SCHEDULE_INTERVAL_HOURS.includes(args.cadence_hours as ScheduleIntervalHours)) {
      return {
        errorCode: 'invalid_cadence_hours',
        summary: '`cadence_hours` must be one of 1, 2, 4, 8, 12, or 24.',
        fix: 'Retry with an allowed interval hour value.',
        retryable: true,
      };
    }
    if (hasDaily && !parseDailyAt(args.daily_at).ok) {
      return {
        errorCode: 'invalid_daily_at',
        summary: '`daily_at` must be a local 24-hour time in HH:MM format.',
        fix: 'Retry with a value like "09:30" or "17:00".',
        retryable: true,
      };
    }
  }
  if ((action === 'delete_schedule' || action === 'run_now') && !(typeof args.id === 'string' && args.id.trim())) {
    return {
      errorCode: 'missing_required_argument',
      summary: '`id` is required for this schedules action.',
      fix: 'Call list_schedules first if you need the schedule id.',
      retryable: true,
    };
  }
  return null;
}

function doCreate(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]) {
  const cadence = cadenceFromArgs(args);
  if (!cadence) return 'Error: provide exactly one of `cadence_hours` or `daily_at`.';
  const schedule = ctx.schedules!.create({
    title: String(args.title ?? ''),
    instructions: String(args.instructions ?? ''),
    cadence,
    model: typeof args.model === 'string' ? args.model : undefined,
    catchUp: args.catch_up === true,
  });
  const next = ctx.schedules!.nextRunAt(schedule.id);
  return {
    ok: true,
    summary: `Created schedule "${schedule.title}" (${formatCadence(schedule.cadence)}). Runs while GatesAI is open.`,
    content: [
      `Created schedule ${schedule.id}: "${schedule.title}"`,
      `cadence: ${formatCadence(schedule.cadence)}`,
      `next_run: ${next ? new Date(next).toISOString() : 'unknown'}`,
      `catch_up: ${schedule.catchUp ? 'true' : 'false'}`,
      'runs_while_app_open: true',
      'Manage this in the Agent menu under Schedules.',
    ].join('\n'),
    data: { id: schedule.id },
  };
}

function doList(ctx: Parameters<Tool['execute']>[1]): string {
  const schedules = ctx.schedules!.sorted;
  if (schedules.length === 0) return 'No schedules yet. Schedules only run while GatesAI is open.';
  return schedules.map(schedule => formatScheduleLine(schedule, ctx.schedules!.nextRunAt(schedule.id))).join('\n');
}

function doDelete(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const removed = ctx.schedules!.remove(id);
  if (!removed) return `Error: no schedule with id "${id}".`;
  return `Deleted schedule ${removed.id}: "${removed.title}"`;
}

function doRunNow(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]) {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const result = ctx.schedules!.runNow(id);
  return {
    ok: result.ok,
    summary: result.message,
    content: result.threadId ? `${result.message}\nthread_id: ${result.threadId}` : result.message,
    ...(result.ok ? {} : { errorCode: 'schedule_run_failed', retryable: true }),
  };
}

function cadenceFromArgs(args: Record<string, unknown>): ScheduleCadence | null {
  if (typeof args.cadence_hours === 'number') {
    if (!SCHEDULE_INTERVAL_HOURS.includes(args.cadence_hours as ScheduleIntervalHours)) return null;
    return { kind: 'interval', hours: args.cadence_hours as ScheduleIntervalHours };
  }
  const daily = parseDailyAt(args.daily_at);
  return daily.ok ? { kind: 'daily', hour: daily.hour, minute: daily.minute } : null;
}

function parseDailyAt(value: unknown): { ok: true; hour: number; minute: number } | { ok: false } {
  if (typeof value !== 'string') return { ok: false };
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return { ok: false };
  return { ok: true, hour: Number(match[1]), minute: Number(match[2]) };
}

function formatScheduleLine(schedule: Schedule, nextRunAt: number | null): string {
  return [
    `${schedule.id} "${schedule.title}"`,
    `enabled=${schedule.enabled ? 'true' : 'false'}`,
    `cadence=${formatCadence(schedule.cadence)}`,
    `next_run=${nextRunAt ? new Date(nextRunAt).toISOString() : 'unknown'}`,
    `catch_up=${schedule.catchUp ? 'true' : 'false'}`,
    `last_run=${schedule.lastRunAt ? new Date(schedule.lastRunAt).toISOString() : 'never'}`,
    `last_result_thread=${schedule.lastResultThreadId ?? 'none'}`,
    'runs_while_app_open=true',
  ].join('  ');
}

function formatCadence(cadence: ScheduleCadence): string {
  if (cadence.kind === 'interval') return `every ${cadence.hours}h`;
  return `daily at ${String(cadence.hour).padStart(2, '0')}:${String(cadence.minute).padStart(2, '0')}`;
}

import { describe, expect, it } from 'vitest';
import { schedulesTool } from '../../../src/services/tools/schedules';
import type { Schedule, ScheduleInput } from '../../../src/core/schedules';
import type { ToolContext } from '../../../src/services/tools/types';

function makeCtx(overrides: Partial<ToolContext>): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    threadId: 't-test',
    ...overrides,
  } as unknown as ToolContext;
}

class FakeSchedules {
  schedules: Schedule[] = [];

  get sorted(): Schedule[] {
    return this.schedules;
  }

  create(input: ScheduleInput): Schedule {
    const schedule: Schedule = {
      id: `s-${this.schedules.length + 1}`,
      title: input.title.trim(),
      instructions: input.instructions.trim(),
      ...(input.model ? { model: input.model } : {}),
      cadence: input.cadence,
      enabled: input.enabled ?? true,
      catchUp: input.catchUp === true,
      createdAt: Date.parse('2026-01-01T00:00:00Z'),
    };
    this.schedules.push(schedule);
    return schedule;
  }

  findById(id: string): Schedule | null {
    return this.schedules.find(schedule => schedule.id === id) ?? null;
  }

  remove(id: string): Schedule | null {
    const index = this.schedules.findIndex(schedule => schedule.id === id);
    if (index < 0) return null;
    const [removed] = this.schedules.splice(index, 1);
    return removed;
  }

  runNow(id: string) {
    return this.findById(id)
      ? { ok: true, message: `Started schedule "${id}".`, threadId: 'agent-1' }
      : { ok: false, message: `No schedule with id "${id}".` };
  }

  nextRunAt(): number {
    return Date.parse('2026-01-01T09:00:00Z');
  }
}

describe('schedules tool', () => {
  it('creates an interval schedule and states the app-open limitation', async () => {
    const schedules = new FakeSchedules();
    const out = await schedulesTool.execute({
      action: 'schedule_task',
      title: 'Morning review',
      instructions: 'Summarize overnight changes.',
      cadence_hours: 24,
      model: 'or-gpt-5.4-mini',
      catch_up: true,
    }, makeCtx({ schedules }));

    expect(typeof out).toBe('object');
    expect(schedules.schedules[0]).toMatchObject({
      title: 'Morning review',
      cadence: { kind: 'interval', hours: 24 },
      model: 'or-gpt-5.4-mini',
      catchUp: true,
    });
    expect(JSON.stringify(out)).toContain('Runs while GatesAI is open');
  });

  it('creates a daily schedule from HH:MM local time', async () => {
    const schedules = new FakeSchedules();
    await schedulesTool.execute({
      action: 'schedule_task',
      title: 'Daily standup',
      instructions: 'Prepare standup notes.',
      daily_at: '09:30',
    }, makeCtx({ schedules }));

    expect(schedules.schedules[0].cadence).toEqual({ kind: 'daily', hour: 9, minute: 30 });
  });

  it('lists schedules with next run and last result thread', async () => {
    const schedules = new FakeSchedules();
    const schedule = schedules.create({
      title: 'List me',
      instructions: 'Run.',
      cadence: { kind: 'interval', hours: 1 },
    });
    schedule.lastRunAt = Date.parse('2026-01-01T08:00:00Z');
    schedule.lastResultThreadId = 'agent-last';

    const out = await schedulesTool.execute({ action: 'list_schedules' }, makeCtx({ schedules }));

    expect(out).toContain('s-1 "List me"');
    expect(out).toContain('next_run=2026-01-01T09:00:00.000Z');
    expect(out).toContain('last_result_thread=agent-last');
    expect(out).toContain('runs_while_app_open=true');
  });

  it('deletes and runs schedules by id', async () => {
    const schedules = new FakeSchedules();
    schedules.create({ title: 'Run me', instructions: 'Run.', cadence: { kind: 'interval', hours: 1 } });

    const run = await schedulesTool.execute({ action: 'run_now', id: 's-1' }, makeCtx({ schedules }));
    expect(JSON.stringify(run)).toContain('agent-1');

    const deleted = await schedulesTool.execute({ action: 'delete_schedule', id: 's-1' }, makeCtx({ schedules }));
    expect(deleted).toContain('Deleted schedule s-1');
    expect(schedules.sorted).toHaveLength(0);
  });

  it('validates required cadence shape for create', () => {
    expect(schedulesTool.meta?.validate?.({
      action: 'schedule_task',
      title: 'Bad',
      instructions: 'Run.',
    })?.errorCode).toBe('invalid_cadence');
    expect(schedulesTool.meta?.validate?.({
      action: 'schedule_task',
      title: 'Bad',
      instructions: 'Run.',
      cadence_hours: 3,
    })?.errorCode).toBe('invalid_cadence_hours');
    expect(schedulesTool.meta?.validate?.({
      action: 'schedule_task',
      title: 'Bad',
      instructions: 'Run.',
      daily_at: '25:00',
    })?.errorCode).toBe('invalid_daily_at');
  });
});

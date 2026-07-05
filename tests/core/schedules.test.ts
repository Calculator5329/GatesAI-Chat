import { describe, expect, it } from 'vitest';
import {
  firstScheduleRunAtOrAfter,
  naturalNextScheduleRunAt,
  nextFutureScheduleRunAt,
  nextScheduleRunAfter,
  normalizeScheduleCadence,
  type Schedule,
} from '../../src/core/schedules';

describe('schedule timing helpers', () => {
  it('computes interval cadences with local wall-clock hour addition', () => {
    const base = new Date(2026, 0, 1, 8, 15, 0, 0).getTime();
    const next = nextScheduleRunAfter({ kind: 'interval', hours: 4 }, base);
    expect(new Date(next).getHours()).toBe(12);
    expect(new Date(next).getMinutes()).toBe(15);
  });

  it('computes daily cadences from local wall-clock time', () => {
    const morning = new Date(2026, 0, 1, 8, 0, 0, 0).getTime();
    const late = new Date(2026, 0, 1, 10, 0, 0, 0).getTime();

    const sameDay = new Date(nextScheduleRunAfter({ kind: 'daily', hour: 9, minute: 30 }, morning));
    expect(sameDay.getDate()).toBe(1);
    expect(sameDay.getHours()).toBe(9);
    expect(sameDay.getMinutes()).toBe(30);

    const nextDay = new Date(nextScheduleRunAfter({ kind: 'daily', hour: 9, minute: 30 }, late));
    expect(nextDay.getDate()).toBe(2);
    expect(nextDay.getHours()).toBe(9);
    expect(nextDay.getMinutes()).toBe(30);
  });

  it('uses Date wall-clock math across a fake DST boundary instead of fixed milliseconds', () => {
    const baseDate = new Date(2026, 2, 8, 1, 30, 0, 0);
    const base = baseDate.getTime();
    const expected = new Date(base);
    expected.setHours(expected.getHours() + 1);

    const next = nextScheduleRunAfter({ kind: 'interval', hours: 1 }, base);

    expect(next).toBe(expected.getTime());
    expect(new Date(next).getHours()).toBe(expected.getHours());
  });

  it('keeps due and future calculations separate', () => {
    const schedule: Schedule = {
      id: 's1',
      title: 'Hourly',
      instructions: 'Run.',
      cadence: { kind: 'interval', hours: 1 },
      enabled: true,
      catchUp: false,
      createdAt: new Date(2026, 0, 1, 8, 0).getTime(),
    };
    const now = new Date(2026, 0, 1, 10, 0).getTime();

    expect(new Date(naturalNextScheduleRunAt(schedule)).getHours()).toBe(9);
    expect(new Date(nextFutureScheduleRunAt(schedule, now)).getHours()).toBe(11);
    expect(new Date(firstScheduleRunAtOrAfter(schedule.cadence, schedule.createdAt, now)).getHours()).toBe(11);
  });

  it('normalizes invalid cadence shapes to supported v1 cadences', () => {
    expect(normalizeScheduleCadence({ kind: 'interval', hours: 3 })).toEqual({ kind: 'interval', hours: 24 });
    expect(normalizeScheduleCadence({ kind: 'daily', hour: 99, minute: -5 })).toEqual({ kind: 'daily', hour: 23, minute: 0 });
    expect(normalizeScheduleCadence(null)).toEqual({ kind: 'interval', hours: 24 });
  });
});

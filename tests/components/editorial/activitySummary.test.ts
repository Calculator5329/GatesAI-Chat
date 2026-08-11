import { describe, expect, it } from 'vitest';
import { formatElapsed, summarizeActivities, traceLane } from '../../../src/components/editorial/aurora/activitySummary';
import type { ActivityItem } from '../../../src/core/types';

function item(overrides: Partial<ActivityItem> & Pick<ActivityItem, 'id' | 'kind'>): ActivityItem {
  return {
    state: 'done',
    verb: 'Ran',
    startedAt: 1_000,
    ...overrides,
  } as ActivityItem;
}

describe('summarizeActivities', () => {
  it('counts tool calls, commands, and reasoning steps separately', () => {
    const summary = summarizeActivities([
      item({ id: 'a', kind: 'tool' }),
      item({ id: 'b', kind: 'tool' }),
      item({ id: 'c', kind: 'exec-tail' }),
      item({ id: 'd', kind: 'thinking' }),
    ]);
    expect(summary.chips.map(chip => chip.label)).toEqual([
      '2 tool calls',
      '1 command',
      '1 reasoning step',
    ]);
  });

  it('sums the line delta across every row that reported one', () => {
    const summary = summarizeActivities([
      item({ id: 'a', kind: 'tool', stats: { added: 3, removed: 1 } }),
      item({ id: 'b', kind: 'tool', stats: { added: 2, removed: 4 } }),
    ]);
    expect(summary.chips.find(chip => chip.id === 'delta')?.label).toBe('+5 −5');
  });

  it('omits a delta chip when nothing reported one', () => {
    const summary = summarizeActivities([item({ id: 'a', kind: 'tool' })]);
    expect(summary.chips.some(chip => chip.id === 'delta')).toBe(false);
  });

  it('reports running and failed state from the rows', () => {
    expect(summarizeActivities([item({ id: 'a', kind: 'tool', state: 'running' })]).running).toBe(true);
    expect(summarizeActivities([item({ id: 'a', kind: 'tool', state: 'failed' })]).failed).toBe(true);
    const quiet = summarizeActivities([item({ id: 'a', kind: 'tool' })]);
    expect(quiet.running).toBe(false);
    expect(quiet.failed).toBe(false);
  });

  it('spans from the earliest start to the latest finish, and is null while nothing finished', () => {
    const summary = summarizeActivities([
      item({ id: 'a', kind: 'tool', startedAt: 1_000, finishedAt: 2_500 }),
      item({ id: 'b', kind: 'tool', startedAt: 1_200, finishedAt: 4_000 }),
    ]);
    expect(summary.elapsedMs).toBe(3_000);
    expect(summarizeActivities([item({ id: 'a', kind: 'tool', state: 'running' })]).elapsedMs).toBeNull();
  });

  it('summarizes an empty run without chips or an elapsed span', () => {
    expect(summarizeActivities([])).toEqual({ chips: [], elapsedMs: null, running: false, failed: false });
  });
});

describe('formatElapsed', () => {
  it('scales the unit with the duration', () => {
    expect(formatElapsed(420)).toBe('420ms');
    expect(formatElapsed(4_200)).toBe('4.2s');
    expect(formatElapsed(66_000)).toBe('1m 06s');
  });
});

describe('traceLane', () => {
  it('routes by kind first, then by verb', () => {
    expect(traceLane(item({ id: 'a', kind: 'thinking' }))).toBe('reasoning');
    expect(traceLane(item({ id: 'b', kind: 'exec-tail' }))).toBe('code');
    expect(traceLane(item({ id: 'c', kind: 'tool', verb: 'Searched' }))).toBe('search');
    expect(traceLane(item({ id: 'd', kind: 'tool', verb: 'Writing' }))).toBe('file');
    expect(traceLane(item({ id: 'd2', kind: 'tool', verb: 'Reading' }))).toBe('file');
    expect(traceLane(item({ id: 'e', kind: 'tool', verb: 'Asked' }))).toBe('step');
  });
});

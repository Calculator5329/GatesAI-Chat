import { describe, expect, it } from 'vitest';
import { groupConsecutive } from '../../../src/components/editorial/activity/groupConsecutive';
import type { ActivityItem } from '../../../src/core/types';

const item = (id: string, groupKey?: string): ActivityItem => ({
  id, kind: 'tool', state: 'done', verb: 'Ran', startedAt: 0, groupKey,
});

describe('groupConsecutive', () => {
  it('returns single-element runs for items with no groupKey', () => {
    const runs = groupConsecutive([item('a'), item('b'), item('c')]);
    expect(runs).toHaveLength(3);
    expect(runs.every(run => run.length === 1)).toBe(true);
  });

  it('groups consecutive same-key items', () => {
    const runs = groupConsecutive([
      item('a', 'shell'),
      item('b', 'shell'),
      item('c', 'shell'),
      item('d'),
      item('e', 'shell'),
    ]);
    expect(runs.map(run => run.map(i => i.id))).toEqual([
      ['a', 'b', 'c'],
      ['d'],
      ['e'],
    ]);
  });

  it('does not group across a non-matching item', () => {
    const runs = groupConsecutive([
      item('a', 'shell'),
      item('b', 'edit'),
      item('c', 'shell'),
    ]);
    expect(runs.map(run => run.map(i => i.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupConsecutive([])).toEqual([]);
  });
});

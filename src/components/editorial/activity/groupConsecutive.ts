import type { ActivityItem } from '../../../core/types';

export function groupConsecutive(items: ActivityItem[]): ActivityItem[][] {
  const runs: ActivityItem[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (item.groupKey && last && last[0].groupKey === item.groupKey) {
      last.push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs;
}

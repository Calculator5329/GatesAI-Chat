import type { ActivityItem } from '../../../core/types';
import { ActivityRow } from './ActivityRow';
import { TimelineGroup } from './TimelineGroup';
import { groupConsecutive } from './groupConsecutive';

export function ActivityStream({ items, header }: { items: ActivityItem[]; header?: string }) {
  if (items.length === 0 && !header) return null;
  const runs = groupConsecutive(items);
  return (
    <div className="activity-stream" aria-label="Assistant activity">
      {header && <div className="activity-stream__header">{header}</div>}
      {runs.map((run, index) =>
        run.length === 1
          ? <ActivityRow key={`${run[0].id}-${index}`} item={run[0]} />
          : <TimelineGroup key={`group-${run[0].id}-${index}`} items={run} />,
      )}
    </div>
  );
}

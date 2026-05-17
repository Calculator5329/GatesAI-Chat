import type { ActivityItem } from '../../../core/types';
import { ActivityRow } from './ActivityRow';

export function ActivityStream({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="activity-stream" aria-label="Assistant activity">
      {items.map((item, index) => <ActivityRow key={`${item.id}-${index}`} item={item} />)}
    </div>
  );
}

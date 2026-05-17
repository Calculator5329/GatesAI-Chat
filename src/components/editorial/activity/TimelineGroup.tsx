import { useState } from 'react';
import type { ActivityItem } from '../../../core/types';
import { ActivityRow } from './ActivityRow';
import { iconForActivity } from './iconForActivity';

export function TimelineGroup({ items }: { items: ActivityItem[] }) {
  const aggregateState = items.some(i => i.state === 'failed')
    ? 'failed'
    : items.some(i => i.state === 'running')
      ? 'running'
      : items.some(i => i.state === 'cancelled')
        ? 'cancelled'
        : 'done';
  const [open, setOpen] = useState(aggregateState === 'failed');
  const icon = iconForActivity(items[0])();
  const verb = items[0].verb;
  const count = items.length;
  const label = `${verb} ${count} commands`;

  return (
    <div className="activity-group activity-row" data-state={aggregateState}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="activity-row__button"
        onClick={() => setOpen(value => !value)}
      >
        <span className="activity-row__icon" aria-hidden="true">{icon}</span>
        <span className="activity-row__label">
          <span>{verb} {count} commands</span>
        </span>
        <span className="activity-row__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="activity-group__children">
          {items.map(child => (
            <div key={child.id} className="activity-group__child">
              <ActivityRow item={child} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

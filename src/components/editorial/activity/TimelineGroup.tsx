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
  const noun = groupNoun(items);
  const label = `${verb} ${count} ${noun}`;

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
          <span>{verb} {count} {noun}</span>
        </span>
        {aggregateState === 'running' && (
          <span className="thinking-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        )}
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

function groupNoun(items: ActivityItem[]): string {
  const first = items[0];
  if (first.kind === 'exec-tail') return 'commands';
  if (first.groupKey === 'tool:terminal') return 'commands';
  if (first.groupKey?.startsWith('tool:edit') || first.groupKey?.startsWith('tool:write')) return 'files';
  if (first.groupKey?.startsWith('tool:read')) return 'files';
  return 'calls';
}

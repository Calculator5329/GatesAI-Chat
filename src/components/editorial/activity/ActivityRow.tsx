import { Suspense, lazy, useEffect, useState } from 'react';
import type { ActivityItem, ActivityStats } from '../../../core/types';
import { WorkspaceImage } from '../WorkspaceImage';
import { ImageJobCard } from '../ImageJobCard';
import { MarkdownFallback } from '../MarkdownFallback';
import { iconForActivity } from './iconForActivity';

const ActivityMarkdown = lazy(() => import('./ActivityMarkdown').then(m => ({ default: m.ActivityMarkdown })));

export function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsedLabel(item.state === 'running', item.startedAt);
  const expandable = Boolean(item.detail || item.artifacts?.length);
  const label = [item.verb, item.target].filter(Boolean).join(' ');
  const summary = item.state === 'failed' || item.state === 'cancelled' || item.state === 'done'
    ? item.summary
    : undefined;
  const icon = iconForActivity(item)();

  return (
    <div className="activity-row" data-state={item.state} data-kind={item.kind}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={!expandable}
        className="activity-row__button"
        onClick={() => expandable && setOpen(value => !value)}
      >
        <span className="activity-row__icon" aria-hidden="true">{icon}</span>
        <span className="activity-row__label">
          <span>{item.verb}</span>
          {item.target && <> <span className="activity-row__target">{item.target}</span></>}
          {summary && <> <span className="activity-row__summary">· {summary}</span></>}
        </span>
        {item.stats && <StatsChips stats={item.stats} />}
        {elapsed && <span className="activity-row__elapsed">· {elapsed}</span>}
        {item.state === 'running' && (
          <span className="thinking-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        )}
        {expandable && <span className="activity-row__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>}
      </button>
      {open && expandable && (
        <div className="activity-row__detail">
          {item.detail?.type === 'markdown' && item.detail.content && (
            <div className="md-body activity-row__markdown">
              <Suspense fallback={<MarkdownFallback content={item.detail.content} />}>
                <ActivityMarkdown content={item.detail.content} />
              </Suspense>
            </div>
          )}
          {item.detail?.type === 'terminal' && (
            <pre className="activity-row__terminal">
              {item.detail.lines?.length
                ? item.detail.lines.map((line, index) => (
                    <span key={`${index}-${line.text}`} data-stream={line.stream}>{line.text}</span>
                  ))
                : <span>{item.detail.placeholder ?? '(no output yet)'}</span>}
              {item.state === 'running' && <span className="stream-caret" />}
            </pre>
          )}
          {item.artifacts?.map((artifact, index) => {
            if (artifact.kind === 'image') {
              return <WorkspaceImage key={`image-${artifact.path}`} path={artifact.path} alt="Generated image" kind="image" />;
            }
            return <ImageJobCard key={`job-${artifact.jobId}-${index}`} jobId={artifact.jobId} expectedCount={artifact.count} />;
          })}
        </div>
      )}
    </div>
  );
}

function StatsChips({ stats }: { stats: ActivityStats }) {
  const hasNumeric = typeof stats.added === 'number' || typeof stats.removed === 'number';
  if (!hasNumeric && !stats.label) return null;
  return (
    <span className="activity-row__stats">
      {typeof stats.added === 'number' && (
        <span className="activity-row__stats-added">+{stats.added}</span>
      )}
      {typeof stats.removed === 'number' && (
        <span className="activity-row__stats-removed">−{stats.removed}</span>
      )}
      {!hasNumeric && stats.label && <span>{stats.label}</span>}
    </span>
  );
}

function useElapsedLabel(active: boolean, startedAt: number): string {
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    if (!active) return;
    const intervalId = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [active, startedAt]);

  return active && seconds >= 4 ? `${seconds}s` : '';
}

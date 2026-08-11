// Aurora pack: the assistant's work, as a compact chip header over a typed
// trace. Replaces ActivityStream when the Aurora pack is active.
// Rendered by ActivityStream's pack switch; depends on ActivityItem contracts.
// Invariant: display-only — it never mutates ChatStore progress, and every row
// it can render is also renderable by the Classic pack.
import { Suspense, lazy, useState } from 'react';
import type { ActivityItem } from '../../../core/types';
import { useEditorial } from '../../../stores/context';
import { MarkdownFallback } from '../MarkdownFallback';
import { WorkspaceImage } from '../WorkspaceImage';
import { ImageJobCard } from '../ImageJobCard';
import { iconForActivity } from '../activity/iconForActivity';
import { AuroraLoader } from './AuroraLoader';
import { DiffCard } from './DiffCard';
import { formatElapsed, summarizeActivities, traceLane } from './activitySummary';

const ActivityMarkdown = lazy(() => import('../activity/ActivityMarkdown').then(m => ({ default: m.ActivityMarkdown })));

export function AuroraActivityStream({
  items,
  header,
  messageId,
  onOpenThread,
}: {
  items: ActivityItem[];
  header?: string;
  messageId?: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const summary = summarizeActivities(items);
  // The trace opens itself while work is live or when something failed —
  // those are the two moments the detail is worth the vertical space.
  const [open, setOpen] = useState(false);
  const expanded = open || summary.running || summary.failed;

  if (items.length === 0 && !header) return null;

  return (
    <div className="aurora-activity" data-state={summary.failed ? 'failed' : summary.running ? 'running' : 'done'}>
      <button
        type="button"
        className="aurora-activity__chips"
        aria-expanded={expanded}
        onClick={() => setOpen(value => !value)}
      >
        {summary.running
          ? <AuroraLoader label={header ?? 'Working'} startedAt={items[0]?.startedAt} />
          : <span className="aurora-activity__title">{header ?? (summary.failed ? 'Ran into a problem' : 'Worked')}</span>}
        {summary.chips.map(chip => (
          <span key={chip.id} className="aurora-chip" data-chip={chip.id}>{chip.label}</span>
        ))}
        {summary.elapsedMs !== null && !summary.running && (
          <span className="aurora-chip aurora-chip--muted">{formatElapsed(summary.elapsedMs)}</span>
        )}
        <span className="aurora-activity__chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded && (
        <ol className="aurora-trace" aria-label="Assistant activity">
          {items.map(item => (
            <AuroraTraceRow key={item.id} item={item} messageId={messageId} onOpenThread={onOpenThread} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AuroraTraceRow({
  item,
  messageId,
  onOpenThread,
}: {
  item: ActivityItem;
  messageId?: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const { ui } = useEditorial();
  const persisted = messageId ? ui.toolOutputOpenState(messageId, item.id) : undefined;
  const [open, setOpen] = useState(persisted ?? item.state === 'failed');
  const lane = traceLane(item);
  const icon = iconForActivity(item)();
  const diffArtifacts = item.artifacts?.filter(artifact => artifact.kind === 'diff') ?? [];
  const imageArtifacts = item.artifacts?.filter(
    artifact => artifact.kind === 'image' || artifact.kind === 'image-job',
  ) ?? [];
  const expandable = Boolean(item.detail?.content || item.detail?.lines?.length || diffArtifacts.length);
  const navigable = Boolean(item.linkThreadId && onOpenThread);

  function toggle(): void {
    if (item.linkThreadId && onOpenThread) {
      onOpenThread(item.linkThreadId);
      return;
    }
    if (!expandable) return;
    const next = !open;
    setOpen(next);
    if (messageId) ui.setToolOutputOpen(messageId, item.id, next);
  }

  return (
    <li className="aurora-trace__row" data-lane={lane} data-state={item.state}>
      <span className="aurora-trace__rail" aria-hidden="true">
        <span className="aurora-trace__dot" />
      </span>
      <div className="aurora-trace__body">
        <button
          type="button"
          className="aurora-trace__head"
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable && !navigable}
          onClick={toggle}
        >
          <span className="aurora-trace__icon" aria-hidden="true">{icon}</span>
          <span className="aurora-trace__verb">{item.verb}</span>
          {item.target && <span className="aurora-trace__target">{item.target}</span>}
          {item.summary && item.state !== 'running' && (
            <span className="aurora-trace__summary">{item.summary}</span>
          )}
          {typeof item.stats?.added === 'number' && <span className="aurora-chip aurora-chip--add">+{item.stats.added}</span>}
          {typeof item.stats?.removed === 'number' && <span className="aurora-chip aurora-chip--remove">−{item.stats.removed}</span>}
          {!item.stats?.added && !item.stats?.removed && item.stats?.label && (
            <span className="aurora-chip aurora-chip--muted">{item.stats.label}</span>
          )}
          {item.state === 'running' && (
            <span className="aurora-trace__pulse" aria-hidden="true"><span /><span /><span /></span>
          )}
          {expandable && <span className="aurora-trace__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>}
        </button>
        {imageArtifacts.length > 0 && (
          <div className="aurora-trace__images">
            {imageArtifacts.map((artifact, index) => artifact.kind === 'image'
              ? <WorkspaceImage key={`image-${artifact.path}`} path={artifact.path} alt="Generated image" kind="image" />
              : <ImageJobCard key={`job-${artifact.jobId}-${index}`} jobId={artifact.jobId} expectedCount={artifact.count} />)}
          </div>
        )}
        {open && diffArtifacts.map((artifact, index) => (
          artifact.kind === 'diff'
            ? <DiffCard key={`diff-${artifact.path}-${index}`} artifact={artifact} />
            : null
        ))}
        {open && item.detail?.type === 'markdown' && item.detail.content && (
          <div className="md-body aurora-trace__markdown">
            <Suspense fallback={<MarkdownFallback content={item.detail.content} />}>
              <ActivityMarkdown content={item.detail.content} />
            </Suspense>
          </div>
        )}
        {open && item.detail?.type === 'terminal' && (
          <pre className="aurora-trace__terminal">
            {item.detail.lines?.length
              ? item.detail.lines.map((line, index) => (
                  <span key={`${index}-${line.text}`} data-stream={line.stream}>{line.text}</span>
                ))
              : <span>{item.detail.placeholder ?? '(no output yet)'}</span>}
            {item.state === 'running' && <span className="stream-caret" />}
          </pre>
        )}
      </div>
    </li>
  );
}

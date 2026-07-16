// Unified background-work ledger for the right dock. Execution remains in
// the task's owning store; this panel only renders and dispatches facade actions.
import { observer } from 'mobx-react-lite';
import type { TaskStatus, TaskView } from '../../stores/TaskStore';
import { useRouterStore, useTaskStore } from '../../stores/context';
import type { DockPanelProps } from './panelRegistry';

const GROUPS: Array<{ title: string; statuses: TaskStatus[] }> = [
  { title: 'Running', statuses: ['running'] },
  { title: 'Queued', statuses: ['pending'] },
  { title: 'History', statuses: ['failed', 'cancelled', 'done'] },
];

export const TaskCenterPanel = observer(function TaskCenterPanel(_props: DockPanelProps) {
  const tasks = useTaskStore();
  const router = useRouterStore();
  const ledger = tasks.tasks;

  if (ledger.length === 0) {
    return (
      <div className="task-center task-center--empty" data-testid="task-center-panel">
        <strong>No background tasks yet</strong>
        <span>Image renders and agent runs will appear here.</span>
      </div>
    );
  }

  return (
    <div className="task-center" data-testid="task-center-panel">
      {GROUPS.map(group => {
        const entries = ledger.filter(task => group.statuses.includes(task.status));
        if (entries.length === 0) return null;
        return (
          <section className="task-center__group" key={group.title} aria-label={`${group.title} tasks`}>
            <div className="task-center__group-title">
              <span>{group.title}</span><b>{entries.length}</b>
            </div>
            {entries.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={task.threadId ? () => router.goThread(task.threadId ?? null) : undefined}
                onCancel={() => tasks.cancel(task.id)}
                onRetry={() => tasks.retry(task.id)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
});

function TaskRow({
  task,
  onOpen,
  onCancel,
  onRetry,
}: {
  task: TaskView;
  onOpen?: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const cancellable = task.status === 'pending' || task.status === 'running';
  const retryable = task.status === 'failed' || task.status === 'cancelled';
  const progress = task.progress && task.progress.max > 0
    ? Math.min(100, Math.max(0, task.progress.value / task.progress.max * 100))
    : null;

  return (
    <article
      className={`task-center__task task-center__task--${task.status}${onOpen ? ' task-center__task--linked' : ''}`}
      data-task-id={task.id}
      onClick={onOpen}
      onKeyDown={event => {
        if (onOpen && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? 'link' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="task-center__task-head">
        <span className={`task-center__kind task-center__kind--${task.kind}`}>{task.kind}</span>
        <strong title={task.title}>{task.title}</strong>
        {task.costUsd != null && task.costUsd > 0 && (
          <span className="task-center__cost">{formatCost(task.costUsd)}</span>
        )}
      </div>
      <div className="task-center__meta">
        <span className="task-center__status">{statusLabel(task.status)}</span>
        {task.results.length > 0 && (
          <span>{task.results.length} result{task.results.length === 1 ? '' : 's'}</span>
        )}
        {task.progress?.label && <span>{task.progress.label}</span>}
      </div>
      {progress != null && (
        <div
          className="task-center__progress"
          role="progressbar"
          aria-label={`${task.title} progress`}
          aria-valuemin={0}
          aria-valuemax={task.progress?.max}
          aria-valuenow={task.progress?.value}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
      {task.error && <div className="task-center__error" title={task.error}>{task.error}</div>}
      {(cancellable || retryable) && (
        <div className="task-center__actions">
          {cancellable && (
            <button type="button" onClick={event => { event.stopPropagation(); onCancel(); }}>Cancel</button>
          )}
          {retryable && (
            <button type="button" onClick={event => { event.stopPropagation(); onRetry(); }}>Retry</button>
          )}
        </div>
      )}
    </article>
  );
}

function formatCost(costUsd: number): string {
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

function statusLabel(status: TaskStatus): string {
  if (status === 'done') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'pending') return 'Waiting';
  return 'In progress';
}

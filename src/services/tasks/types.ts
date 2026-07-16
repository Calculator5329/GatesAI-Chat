// Generic read model for background work surfaced by TaskStore and the dock.
// Runners keep owning their domain-specific inputs and execution state; this
// contract only promotes the lifecycle fields shared by every task kind.

export type TaskKind = 'image' | 'agent' | 'command';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskProgress {
  value: number;
  max: number;
  /** Optional human-readable unit, for example "Round 2 of 6". */
  label?: string;
}

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  /** Thread that produced the task and should open when the row is selected. */
  threadId?: string;
  status: TaskStatus;
  progress?: TaskProgress;
  /** Result references: workspace paths for images, final text for agents. */
  results: string[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  costUsd?: number;
}

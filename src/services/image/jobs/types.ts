import type { ImageBackendId } from '../types';

export type ImageJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ImageJobInput {
  threadId: string;
  prompt: string;
  count: number;
  width: number;
  height: number;
  seed?: number;
  backend: ImageBackendId;
}

export interface ImageJob extends ImageJobInput {
  id: string;
  status: ImageJobStatus;
  /** Set while status === 'running'. */
  progress?: { value: number; max: number };
  /** Workspace paths of completed images in the batch. Grows during a multi-image run. */
  results: string[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Subset of {@link ImageJob} that survives across app restarts. Pending /
 * running jobs are dropped on save — only terminal states (done, failed,
 * cancelled) make it to disk.
 */
export interface CompletedJob extends ImageJob {
  status: 'done' | 'failed' | 'cancelled';
}

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
  /**
   * Slug-form filename hint passed from the AI tool call (or derived from
   * the prompt). Local backends use this to control where the file lands
   * (e.g. ComfyUI's `SaveImage.filename_prefix`). Cloud backends ignore it.
   */
  filenamePrefix?: string;
}

export interface ImageJob extends ImageJobInput {
  id: string;
  status: ImageJobStatus;
  /** Set while status === 'running'. */
  progress?: { value: number; max: number };
  /**
   * Recorded image references for completed images in the batch. Each entry
   * is either a workspace path (`/workspace/...`) the bridge can read OR a
   * hosted URL (`http://...`) the UI loads directly. The card / Lightbox
   * / Gallery branch on `startsWith('http')`.
   */
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

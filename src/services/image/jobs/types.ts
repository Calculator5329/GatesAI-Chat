// Defines image-job types contracts and progress adapters shared by stores and backends.
// Called by ImageJobStore and image backend clients; depends on image job status and ComfyUI payload shapes.
// Invariant: progress updates are advisory while terminal job status remains authoritative.
import type { ImageBackendId, LocalComfyMode } from '../types';

export type ImageJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ImageJobInput {
  threadId: string;
  prompt: string;
  count: number;
  width: number;
  height: number;
  seed?: number;
  backend: ImageBackendId;
  /** Direct-image ComfyUI mode override, independent from Local defaults. */
  comfyMode?: LocalComfyMode;
  /**
   * Slug-form filename hint passed from the AI tool call (or derived from
   * the prompt). Local backends use this to control where the file lands
   * (e.g. ComfyUI's `SaveImage.filename_prefix`). Cloud backends ignore it.
   */
  filenamePrefix?: string;
  /** Whether the chat should post a terminal follow-up when this job ends. */
  notifyOnTerminal?: boolean;
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
  /** Sum of provider-reported charges for this job, when available. */
  costUsd?: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Subset of {@link ImageJob} that survives in history across app restarts.
 * Queued / running jobs are also snapshotted by the store so a reload can
 * mark them as retryable failures instead of losing the chat card entirely.
 */
export interface CompletedJob extends ImageJob {
  status: 'done' | 'failed' | 'cancelled';
}

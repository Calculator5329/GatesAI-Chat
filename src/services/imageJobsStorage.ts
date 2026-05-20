// Persists or coordinates service-level state for imageJobsStorage.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import type { CompletedJob, ImageJob } from './image/jobs/types';
import { isImageBackendId } from './image/types';
import { jsonSlot } from './storage/jsonSlot';

export const IMAGE_JOBS_KEY = 'gatesai.imagejobs.v1';

interface PersistedShape {
  history: CompletedJob[];
  queue?: ImageJob[];
  active?: ImageJob | null;
}

export const imageJobsPersistence = jsonSlot<PersistedShape>(IMAGE_JOBS_KEY, raw => {
  if (!raw || typeof raw !== 'object') return { history: [] };
  const shape = raw as { history?: unknown; queue?: unknown; active?: unknown };
  const active = parseImageJob(shape.active);
  return {
    history: Array.isArray(shape.history)
      ? shape.history.map(parseCompletedJob).filter((job): job is CompletedJob => job !== null)
      : [],
    queue: Array.isArray(shape.queue)
      ? shape.queue.map(parseImageJob).filter((job): job is ImageJob => job !== null)
      : [],
    active,
  };
});

function parseCompletedJob(value: unknown): CompletedJob | null {
  const job = parseImageJob(value);
  return job && (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled')
    ? job as CompletedJob
    : null;
}

function parseImageJob(value: unknown): ImageJob | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const threadId = stringField(value.threadId);
  const prompt = stringField(value.prompt);
  const count = positiveInteger(value.count);
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const backend = isImageBackendId(value.backend) ? value.backend : null;
  const status = parseStatus(value.status);
  const results = Array.isArray(value.results)
    ? value.results.filter((item): item is string => typeof item === 'string')
    : [];
  const createdAt = numberField(value.createdAt);
  if (!id || !threadId || !prompt || !count || !width || !height || !backend || !status || createdAt === undefined) {
    return null;
  }
  return {
    id,
    threadId,
    prompt,
    count,
    width,
    height,
    seed: numberField(value.seed),
    backend,
    comfyMode: parseComfyMode(value.comfyMode),
    filenamePrefix: stringField(value.filenamePrefix),
    notifyOnTerminal: booleanField(value.notifyOnTerminal),
    status,
    progress: parseProgress(value.progress),
    results,
    costUsd: numberField(value.costUsd),
    error: stringField(value.error),
    createdAt,
    startedAt: numberField(value.startedAt),
    completedAt: numberField(value.completedAt),
  };
}

function parseStatus(value: unknown): ImageJob['status'] | null {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'failed' || value === 'cancelled'
    ? value
    : null;
}

function parseComfyMode(value: unknown): ImageJob['comfyMode'] {
  return value === 'draft' || value === 'normal' || value === 'upscale' ? value : undefined;
}

function parseProgress(value: unknown): ImageJob['progress'] {
  if (!isRecord(value)) return undefined;
  const progressValue = numberField(value.value);
  const max = numberField(value.max);
  return progressValue !== undefined && max !== undefined ? { value: progressValue, max } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function loadImageJobsHistory(): CompletedJob[] {
  return imageJobsPersistence.load().history;
}

export function loadImageJobsSnapshot(): PersistedShape {
  return imageJobsPersistence.load();
}

export function saveImageJobsHistory(history: CompletedJob[]): void {
  imageJobsPersistence.save({ history });
}

export function saveImageJobsSnapshot(snapshot: PersistedShape): void {
  imageJobsPersistence.save({
    history: snapshot.history,
    queue: snapshot.queue ?? [],
    active: snapshot.active ?? null,
  });
}

export const clearImageJobsHistory = imageJobsPersistence.clear;

import type { CompletedJob, ImageJob } from './image/jobs/types';
import { jsonSlot } from './storage/jsonSlot';

export const IMAGE_JOBS_KEY = 'gatesai.imagejobs.v1';

interface PersistedShape {
  history: CompletedJob[];
  queue?: ImageJob[];
  active?: ImageJob | null;
}

const slot = jsonSlot<PersistedShape>(IMAGE_JOBS_KEY, raw => {
  if (!raw || typeof raw !== 'object') return { history: [] };
  const shape = raw as { history?: unknown; queue?: unknown; active?: unknown };
  return {
    history: Array.isArray(shape.history) ? (shape.history as CompletedJob[]) : [],
    queue: Array.isArray(shape.queue) ? (shape.queue as ImageJob[]) : [],
    active: shape.active && typeof shape.active === 'object' ? (shape.active as ImageJob) : null,
  };
});

export function loadImageJobsHistory(): CompletedJob[] {
  return slot.load().history;
}

export function loadImageJobsSnapshot(): PersistedShape {
  return slot.load();
}

export function saveImageJobsHistory(history: CompletedJob[]): void {
  slot.save({ history });
}

export function saveImageJobsSnapshot(snapshot: PersistedShape): void {
  slot.save({
    history: snapshot.history,
    queue: snapshot.queue ?? [],
    active: snapshot.active ?? null,
  });
}

export const clearImageJobsHistory = slot.clear;

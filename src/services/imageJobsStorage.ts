import type { CompletedJob } from './image/jobs/types';
import { jsonSlot } from './storage/jsonSlot';

export const IMAGE_JOBS_KEY = 'gatesai.imagejobs.v1';

interface PersistedShape {
  history: CompletedJob[];
}

const slot = jsonSlot<PersistedShape>(IMAGE_JOBS_KEY, raw => {
  if (!raw || typeof raw !== 'object') return { history: [] };
  const arr = (raw as { history?: unknown }).history;
  return { history: Array.isArray(arr) ? (arr as CompletedJob[]) : [] };
});

export function loadImageJobsHistory(): CompletedJob[] {
  return slot.load().history;
}

export function saveImageJobsHistory(history: CompletedJob[]): void {
  slot.save({ history });
}

export const clearImageJobsHistory = slot.clear;

import type { CompletedJob } from './image/jobs/types';

export const IMAGE_JOBS_KEY = 'gatesai.imagejobs.v1';

interface PersistedShape {
  history: CompletedJob[];
}

function isPersistedShape(v: unknown): v is PersistedShape {
  if (!v || typeof v !== 'object') return false;
  const arr = (v as { history?: unknown }).history;
  return Array.isArray(arr);
}

export function loadImageJobsHistory(): CompletedJob[] {
  try {
    const raw = localStorage.getItem(IMAGE_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedShape(parsed)) return [];
    return parsed.history;
  } catch {
    return [];
  }
}

export function saveImageJobsHistory(history: CompletedJob[]): void {
  try {
    const payload: PersistedShape = { history };
    localStorage.setItem(IMAGE_JOBS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

export function clearImageJobsHistory(): void {
  try {
    localStorage.removeItem(IMAGE_JOBS_KEY);
  } catch {
    // ignore
  }
}

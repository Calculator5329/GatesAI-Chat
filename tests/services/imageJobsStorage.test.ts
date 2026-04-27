import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadImageJobsHistory,
  saveImageJobsHistory,
  clearImageJobsHistory,
  IMAGE_JOBS_KEY,
} from '../../src/services/imageJobsStorage';
import type { CompletedJob } from '../../src/services/image/jobs/types';

const ONE: CompletedJob = {
  id: 'job-1',
  threadId: 't1',
  prompt: 'a sunset',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
  status: 'done',
  results: ['/workspace/artifacts/foo.png'],
  createdAt: 1,
  completedAt: 2,
};

describe('imageJobsStorage', () => {
  beforeEach(() => localStorage.removeItem(IMAGE_JOBS_KEY));
  afterEach(() => localStorage.removeItem(IMAGE_JOBS_KEY));

  it('returns [] when no entry exists', () => {
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('round-trips a single job', () => {
    saveImageJobsHistory([ONE]);
    expect(loadImageJobsHistory()).toEqual([ONE]);
  });

  it('returns [] when the entry is malformed JSON', () => {
    localStorage.setItem(IMAGE_JOBS_KEY, '{not json');
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('returns [] when the entry is the wrong shape', () => {
    localStorage.setItem(IMAGE_JOBS_KEY, JSON.stringify({ wrong: true }));
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('clearImageJobsHistory removes the entry', () => {
    saveImageJobsHistory([ONE]);
    clearImageJobsHistory();
    expect(loadImageJobsHistory()).toEqual([]);
  });
});

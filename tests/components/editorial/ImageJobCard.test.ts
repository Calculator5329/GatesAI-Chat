import { describe, expect, it } from 'vitest';
import { pickCardVariant } from '../../../src/components/editorial/ImageJobCard';
import type { ImageJob, CompletedJob } from '../../../src/services/image/jobs/types';

const baseJob: ImageJob = {
  id: 'j',
  threadId: 't',
  prompt: 'p',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
  status: 'pending',
  results: [],
  createdAt: 1,
};

describe('pickCardVariant', () => {
  it('returns "missing" when there is no job', () => {
    expect(pickCardVariant(null)).toBe('missing');
  });

  it('returns "running" for pending and running jobs', () => {
    expect(pickCardVariant({ ...baseJob, status: 'pending' })).toBe('running');
    expect(pickCardVariant({ ...baseJob, status: 'running' })).toBe('running');
  });

  it('returns terminal-state variants', () => {
    const failed: CompletedJob = { ...baseJob, status: 'failed', error: 'x' };
    const cancelled: CompletedJob = { ...baseJob, status: 'cancelled' };
    expect(pickCardVariant(failed)).toBe('failed');
    expect(pickCardVariant(cancelled)).toBe('cancelled');
  });

  it('distinguishes single vs grid done states', () => {
    const single: CompletedJob = { ...baseJob, status: 'done', results: ['/workspace/artifacts/a.png'] };
    const grid: CompletedJob = { ...baseJob, status: 'done', results: ['/a.png', '/b.png', '/c.png'] };
    const empty: CompletedJob = { ...baseJob, status: 'done', results: [] };
    expect(pickCardVariant(single)).toBe('done-single');
    expect(pickCardVariant(grid)).toBe('done-grid');
    expect(pickCardVariant(empty)).toBe('done-empty');
  });
});

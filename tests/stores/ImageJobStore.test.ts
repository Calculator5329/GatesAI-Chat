import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageJobStore } from '../../src/stores/ImageJobStore';
import type { ImageJobInput } from '../../src/services/image/jobs/types';
import { clearAppStorage } from '../helpers/storage';

const INPUT: ImageJobInput = {
  threadId: 't1',
  prompt: 'a sunset',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
};

describe('ImageJobStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('starts with empty queue and history', () => {
    const store = new ImageJobStore();
    expect(store.queue).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.active).toBeNull();
  });

  it('enqueue() returns a stable id and pushes onto the queue', () => {
    const store = new ImageJobStore();
    const { jobId, count } = store.enqueue(INPUT);
    expect(typeof jobId).toBe('string');
    expect(count).toBe(1);
    const job = store.findById(jobId);
    expect(job).not.toBeNull();
    expect(job?.prompt).toBe('a sunset');
  });

  it('cancel() removes the job and marks cancelled in history', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    expect(store.queue).toEqual([]);
    expect(store.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('history rehydrates from localStorage on next construction', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    const store2 = new ImageJobStore();
    expect(store2.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('delete() removes a job from history', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    store.delete(jobId);
    expect(store.history.find(j => j.id === jobId)).toBeUndefined();
  });

  it('clearHistory() empties history and storage', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    expect(store.history.length).toBeGreaterThan(0);
    store.clearHistory();
    expect(store.history).toEqual([]);
    const store2 = new ImageJobStore();
    expect(store2.history).toEqual([]);
  });
});

import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type {
  CompletedJob,
  ImageJob,
  ImageJobInput,
} from '../services/image/jobs/types';
import {
  loadImageJobsHistory,
  saveImageJobsHistory,
  clearImageJobsHistory,
} from '../services/imageJobsStorage';

const HISTORY_LIMIT = 200;

/**
 * Owns the image-generation queue, the active job, and the persisted
 * completed-job history. Only completed (terminal-state) jobs persist —
 * if the user closes the app mid-render, the in-flight work is lost.
 *
 * The runner method drives one job at a time. Task 5 of the plan
 * replaces the stub `runNext` with the real runner.
 */
export class ImageJobStore {
  queue: ImageJob[] = [];
  active: ImageJob | null = null;
  history: CompletedJob[] = [];

  private idCounter = 0;
  private inflight: AbortController | null = null;

  constructor() {
    this.history = loadImageJobsHistory();
    makeAutoObservable<this, 'idCounter' | 'inflight'>(this, {
      idCounter: false,
      inflight: false,
    });
    autorun(() => {
      saveImageJobsHistory(toJS(this.history));
    });
  }

  enqueue(input: ImageJobInput): { jobId: string; count: number } {
    const job: ImageJob = {
      ...input,
      id: this.nextId(),
      status: 'pending',
      results: [],
      createdAt: Date.now(),
    };
    runInAction(() => {
      this.queue.push(job);
    });
    void this.runNext();
    return { jobId: job.id, count: job.count };
  }

  cancel(jobId: string): void {
    if (this.active?.id === jobId) {
      this.inflight?.abort();
      this.moveToHistory(this.active, 'cancelled');
      runInAction(() => { this.active = null; });
      void this.runNext();
      return;
    }
    const idx = this.queue.findIndex(j => j.id === jobId);
    if (idx >= 0) {
      const [job] = this.queue.splice(idx, 1);
      this.moveToHistory(job, 'cancelled');
    }
  }

  findById(jobId: string): ImageJob | CompletedJob | null {
    if (this.active?.id === jobId) return this.active;
    const pending = this.queue.find(j => j.id === jobId);
    if (pending) return pending;
    return this.history.find(j => j.id === jobId) ?? null;
  }

  delete(jobId: string): void {
    runInAction(() => {
      this.history = this.history.filter(j => j.id !== jobId);
    });
  }

  clearHistory(): void {
    runInAction(() => { this.history = []; });
    clearImageJobsHistory();
  }

  /** Stub runner — Task 5 replaces this. */
  private async runNext(): Promise<void> {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    runInAction(() => {
      this.active = next;
      next.status = 'running';
      next.startedAt = Date.now();
    });
    await new Promise(r => setTimeout(r, 0));
    // If the job was cancelled while we awaited, bail out — `cancel`
    // already moved it into history. Assign through a variable to bust
    // TS's stale narrowing of `this.active` from the early-return above.
    const stillActive = this.active as ImageJob | null;
    if (stillActive?.id !== next.id) return;
    runInAction(() => {
      next.status = 'failed';
      next.error = 'Image runner not implemented yet (image-gen UX overhaul Task 5)';
      next.completedAt = Date.now();
      this.active = null;
    });
    this.moveToHistory(next, 'failed');
    void this.runNext();
  }

  private moveToHistory(job: ImageJob, finalStatus: 'done' | 'failed' | 'cancelled'): void {
    runInAction(() => {
      const completed: CompletedJob = {
        ...toJS(job),
        status: finalStatus,
        completedAt: job.completedAt ?? Date.now(),
        progress: undefined,
      };
      this.history = [completed, ...this.history].slice(0, HISTORY_LIMIT);
    });
  }

  private nextId(): string {
    this.idCounter++;
    return `imgjob-${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }
}

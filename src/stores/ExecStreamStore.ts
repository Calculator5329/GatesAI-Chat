// Owns observable ExecStreamStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { makeAutoObservable, runInAction } from 'mobx';

/**
 * In-flight `terminal.run` jobs. The terminal tool registers a job at
 * the start of execution and feeds streamed stdout/stderr lines into it
 * as they arrive from the bridge. The Editorial chat UI observes this
 * map and shows a live "last 10 lines" panel beneath the assistant
 * message that triggered the call.
 *
 * On completion the job is left in place for ~10 seconds so the user
 * sees the last output, then auto-cleared. The model's tool result
 * carries the full captured output independently — this store is purely
 * a UX layer, never part of the conversation history.
 */

export interface ExecStreamJob {
  id: string;
  threadId?: string;
  toolCallId?: string;
  cmd: string;
  args: string[];
  startedAt: number;
  /** Last N lines of combined stdout+stderr, newest at the bottom. */
  tail: ExecStreamLine[];
  status: 'running' | 'done' | 'error';
  exitCode?: number;
  durationMs?: number;
}

export interface ExecStreamLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

const TAIL_LIMIT = 10;
const DONE_LINGER_MS = 10_000;

export class ExecStreamStore {
  jobs: Record<string, ExecStreamJob> = {};

  constructor() {
    makeAutoObservable(this);
  }

  start(id: string, cmd: string, args: string[], meta: { threadId?: string; toolCallId?: string } = {}): void {
    this.jobs[id] = {
      id, threadId: meta.threadId, toolCallId: meta.toolCallId, cmd, args, startedAt: Date.now(),
      tail: [], status: 'running',
    };
  }

  appendChunk(id: string, stream: 'stdout' | 'stderr', text: string): void {
    const job = this.jobs[id];
    if (!job) return;
    job.tail.push({ stream, text });
    if (job.tail.length > TAIL_LIMIT) {
      job.tail.splice(0, job.tail.length - TAIL_LIMIT);
    }
  }

  finish(id: string, exitCode: number, durationMs: number): void {
    const job = this.jobs[id];
    if (!job) return;
    job.status = exitCode === 0 ? 'done' : 'error';
    job.exitCode = exitCode;
    job.durationMs = durationMs;
    setTimeout(() => {
      runInAction(() => { delete this.jobs[id]; });
    }, DONE_LINGER_MS);
  }

  fail(id: string, message: string): void {
    const job = this.jobs[id];
    if (!job) return;
    job.status = 'error';
    job.tail.push({ stream: 'stderr', text: message });
    setTimeout(() => {
      runInAction(() => { delete this.jobs[id]; });
    }, DONE_LINGER_MS);
  }
}

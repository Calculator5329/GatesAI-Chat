// Browser-tab leadership for the chat persistence owner. This deliberately
// holds an exclusive Web Lock for the lifetime of the active tab; queued lock
// requests are woken by the browser when that tab closes.
import { logger } from '../diagnostics/logger';

export const CHAT_LEADER_LOCK_NAME = 'gatesai.chat.persistence.v1';

export type LeaderElectionState = 'fallback' | 'follower' | 'leader';

export interface WebLockRequestOptions {
  mode?: 'exclusive' | 'shared';
  signal?: AbortSignal;
  steal?: boolean;
}

export interface WebLocksApi {
  request(
    name: string,
    options: WebLockRequestOptions,
    callback: (lock: unknown) => unknown | Promise<unknown>,
  ): Promise<unknown>;
}

export interface WebLocksLeaderElectionOptions {
  /** Injected by tests; browsers use navigator.locks by default. */
  locks?: WebLocksApi | null;
  lockName?: string;
}

/**
 * A small state machine around the Web Locks API.
 *
 * The first caller whose request callback runs is the leader. All later
 * callers remain followers while their request is pending. We intentionally
 * never use `steal`: an active chat should hand off only when its holder goes
 * away, so no tab can silently take ownership from another live tab.
 */
export class WebLocksLeaderElection {
  private readonly locks: WebLocksApi | null;
  private readonly lockName: string;
  private readonly listeners = new Set<(state: LeaderElectionState) => void>();
  private releaseLock: (() => void) | null = null;
  private abortPending: AbortController | null = null;
  private started = false;
  private stopped = false;

  state: LeaderElectionState;

  constructor(options: WebLocksLeaderElectionOptions = {}) {
    this.locks = options.locks === undefined ? browserLocks() : options.locks;
    this.lockName = options.lockName ?? CHAT_LEADER_LOCK_NAME;
    this.state = this.locks ? 'follower' : 'fallback';
  }

  /** True only for the tab currently allowed to write shared chat state. */
  get canWrite(): boolean {
    return this.state !== 'follower';
  }

  /** True when the legacy storage-event conflict path must remain active. */
  get usesLegacyFallback(): boolean {
    return this.state === 'fallback';
  }

  subscribe(listener: (state: LeaderElectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started || this.stopped || !this.locks) return;
    this.started = true;
    this.abortPending = new AbortController();
    void this.locks.request(
      this.lockName,
      { mode: 'exclusive', signal: this.abortPending.signal },
      async () => {
        // A request may acquire just as dispose() aborts its pending wait.
        if (this.stopped) return;
        this.transition('leader');
        await new Promise<void>(resolve => { this.releaseLock = resolve; });
        this.releaseLock = null;
        if (!this.stopped) this.transition('follower');
      },
    ).catch(err => {
      if (this.stopped || isAbortError(err)) return;
      // A broken implementation is less safe than no implementation: use the
      // established storage-event conflict fallback instead of stranding the
      // tab read-only forever.
      logger.warn('persistence', 'Web Locks leader election failed; using multi-tab conflict fallback', err);
      this.transition('fallback');
    });
  }

  /** Release a held lock and cancel a still-pending request during teardown. */
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abortPending?.abort();
    this.releaseLock?.();
    this.releaseLock = null;
    this.listeners.clear();
  }

  private transition(next: LeaderElectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

function browserLocks(): WebLocksApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { locks?: WebLocksApi }).locks ?? null;
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';
}

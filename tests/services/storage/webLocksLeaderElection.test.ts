import { describe, expect, it } from 'vitest';
import {
  CHAT_LEADER_LOCK_NAME,
  WebLocksLeaderElection,
  type WebLockRequestOptions,
  type WebLocksApi,
} from '../../../src/services/storage/webLocksLeaderElection';

interface PendingRequest {
  options: WebLockRequestOptions;
  callback: (lock: unknown) => Promise<void> | void;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Minimal Web Locks scheduler: exclusive requests queue until the holder releases. */
class MockLocks implements WebLocksApi {
  readonly requests: Array<{ name: string; options: WebLockRequestOptions }> = [];
  private active = false;
  private readonly pending: PendingRequest[] = [];

  request(
    name: string,
    options: WebLockRequestOptions,
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown> {
    this.requests.push({ name, options });
    return new Promise((resolve, reject) => {
      const pending = { options, callback, resolve, reject };
      options.signal?.addEventListener('abort', () => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) {
          this.pending.splice(index, 1);
          reject(new DOMException('aborted', 'AbortError'));
        }
      }, { once: true });
      this.pending.push(pending);
      this.grantNext();
    });
  }

  private grantNext(): void {
    if (this.active || this.pending.length === 0) return;
    const next = this.pending.shift()!;
    this.active = true;
    void Promise.resolve(next.callback({})).then(() => {
      this.active = false;
      next.resolve(undefined);
      this.grantNext();
    }, next.reject);
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebLocksLeaderElection', () => {
  it('acquires once, never steals a live tab, and hands leadership to a queued follower', async () => {
    const locks = new MockLocks();
    const first = new WebLocksLeaderElection({ locks });
    const second = new WebLocksLeaderElection({ locks });

    first.start();
    await settle();
    expect(first.state).toBe('leader');
    expect(first.canWrite).toBe(true);

    second.start();
    await settle();
    expect(second.state).toBe('follower');
    expect(second.canWrite).toBe(false);
    expect(locks.requests).toEqual([
      { name: CHAT_LEADER_LOCK_NAME, options: expect.objectContaining({ mode: 'exclusive' }) },
      { name: CHAT_LEADER_LOCK_NAME, options: expect.objectContaining({ mode: 'exclusive' }) },
    ]);
    expect(locks.requests.every(request => request.options.steal === undefined)).toBe(true);

    // Closing/disposing the leader resolves its lock callback, which wakes the
    // queued request just as the real Web Locks API does on tab close.
    first.dispose();
    await settle();
    expect(second.state).toBe('leader');
    expect(second.canWrite).toBe(true);
    second.dispose();
  });

  it('uses the legacy-safe writable fallback when Web Locks are unavailable', () => {
    const election = new WebLocksLeaderElection({ locks: null });
    const seen: string[] = [];
    election.subscribe(state => seen.push(state));
    election.start();

    expect(election.state).toBe('fallback');
    expect(election.canWrite).toBe(true);
    expect(election.usesLegacyFallback).toBe(true);
    expect(seen).toEqual(['fallback']);
  });
});

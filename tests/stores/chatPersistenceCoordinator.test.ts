// The chat persistence policy: pause/resume, and the serialized workspace
// save queue. Untested until now, which is uncomfortable for the component
// that decides whether your conversations reach disk.
//
// Uses the real localStorage persistence path rather than a mock — the point
// of these tests is that a snapshot actually lands, not that a spy was called.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatPersistenceCoordinator,
  snapshotLatestUpdatedAt,
  trackSnapshotDeep,
} from '../../src/stores/chatPersistenceCoordinator';
import { flushPendingSnapshot, loadSnapshot } from '../../src/services/persistence';
import { clearAppStorage } from '../helpers/storage';
import type { ChatSnapshot, Message, Thread } from '../../src/core/types';
import type { WorkspaceChatPersistence } from '../../src/services/workspaceChatPersistence';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    title: 'Thread',
    subtitle: '',
    createdAt: 1_000,
    updatedAt: 2_000,
    pinned: false,
    modelId: 'model-a',
    messages: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return { threads: [makeThread()], activeThreadId: 't1', ...overrides };
}

function userMessage(id: string, text: string): Message {
  return { id, role: 'user', content: text, createdAt: 5_000 };
}

/** A workspace persistence whose saves resolve only when the test says so. */
function deferredWorkspacePersistence() {
  const saved: ChatSnapshot[] = [];
  const resolvers: Array<() => void> = [];
  const persistence: WorkspaceChatPersistence = {
    load: async () => ({ kind: 'missing' }),
    backupMalformed: async () => 'backup',
    save: async (snapshot: ChatSnapshot) => {
      saved.push(snapshot);
      await new Promise<void>(resolve => resolvers.push(resolve));
    },
  };
  return {
    persistence,
    saved,
    /** Let the oldest in-flight save finish, then drain microtasks. */
    async settleOne() {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

beforeEach(() => clearAppStorage());
afterEach(() => {
  vi.restoreAllMocks();
  clearAppStorage();
});

describe('ChatPersistenceCoordinator — local writes', () => {
  it('persists a scheduled snapshot, and reads it back', () => {
    const snapshot = makeSnapshot();
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);

    coordinator.schedule(snapshot);
    flushPendingSnapshot();

    expect(loadSnapshot()?.threads.map(t => t.id)).toEqual(['t1']);
  });

  it('writes nothing while paused, and resumes cleanly', () => {
    const snapshot = makeSnapshot();
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);

    coordinator.pause();
    expect(coordinator.isPaused).toBe(true);
    coordinator.schedule(snapshot);
    flushPendingSnapshot();
    // A paused coordinator is the follower tab in a multi-tab session; if it
    // wrote, it would clobber the leader's state with its own stale copy.
    expect(loadSnapshot()).toBeNull();

    coordinator.resume();
    expect(coordinator.isPaused).toBe(false);
    coordinator.schedule(snapshot);
    flushPendingSnapshot();
    expect(loadSnapshot()?.threads.map(t => t.id)).toEqual(['t1']);
  });
});

describe('ChatPersistenceCoordinator — workspace save queue', () => {
  it('mirrors the current snapshot as soon as the bridge attaches', () => {
    const snapshot = makeSnapshot();
    const workspace = deferredWorkspacePersistence();
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);

    expect(workspace.saved).toHaveLength(0);
    coordinator.attachWorkspacePersistence(workspace.persistence);
    expect(workspace.saved).toEqual([snapshot]);
  });

  it('never runs two saves at once, and coalesces to the newest snapshot', async () => {
    let current = makeSnapshot();
    const workspace = deferredWorkspacePersistence();
    const coordinator = new ChatPersistenceCoordinator(() => current);
    coordinator.attachWorkspacePersistence(workspace.persistence);
    expect(workspace.saved).toHaveLength(1);

    // Three more snapshots arrive while the first save is still in flight.
    const second = makeSnapshot({ activeThreadId: 'second' });
    const third = makeSnapshot({ activeThreadId: 'third' });
    const newest = makeSnapshot({ activeThreadId: 'newest' });
    for (const snap of [second, third, newest]) coordinator.schedule(snap);

    // Still exactly one save running: the queue serializes rather than
    // firing a concurrent write per keystroke during streaming.
    expect(workspace.saved).toHaveLength(1);

    await workspace.settleOne();

    // The two intermediate snapshots are superseded, not queued behind each
    // other — writing them would be wasted IO for state already stale.
    expect(workspace.saved).toHaveLength(2);
    expect(workspace.saved[1]).toBe(newest);

    await workspace.settleOne();
    expect(workspace.saved).toHaveLength(2);
  });

  it('survives a failing save instead of wedging the queue forever', async () => {
    const snapshot = makeSnapshot();
    const failing: WorkspaceChatPersistence = {
      load: async () => ({ kind: 'missing' }),
      backupMalformed: async () => 'backup',
      save: vi.fn()
        .mockRejectedValueOnce(new Error('bridge went away'))
        .mockResolvedValue(undefined),
    };
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);

    coordinator.attachWorkspacePersistence(failing);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The rejection is swallowed and logged, and crucially the in-flight flag
    // is cleared — otherwise one dropped bridge connection would silently end
    // workspace persistence for the rest of the session.
    const later = makeSnapshot({ activeThreadId: 'later' });
    coordinator.schedule(later);
    await Promise.resolve();

    expect(failing.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(failing.save).mock.calls[1][0]).toBe(later);
  });

  it('ignores workspace saves until a bridge is attached', () => {
    const snapshot = makeSnapshot();
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);
    expect(() => coordinator.schedule(snapshot)).not.toThrow();
  });
});

describe('trackSnapshotDeep', () => {
  // This function exists solely to register MobX dependencies on nested
  // fields. When it stops covering a field, the symptom is invisible in tests
  // that only check the store: the autosave simply never fires and a
  // conversation is lost on reload.
  it('changes when a message is appended', () => {
    const before = [makeThread()];
    const after = [makeThread({ messages: [userMessage('m1', 'hello')] })];
    expect(trackSnapshotDeep(after)).not.toBe(trackSnapshotDeep(before));
  });

  it('changes when streamed text grows inside an existing message', () => {
    const short = [makeThread({ messages: [userMessage('m1', 'hi')] })];
    const long = [makeThread({ messages: [userMessage('m1', 'hi there')] })];
    expect(trackSnapshotDeep(long)).not.toBe(trackSnapshotDeep(short));
  });

  it('changes on rename, pin, summary and context edits', () => {
    const base = makeThread();
    const variants: Thread[] = [
      { ...base, title: 'Renamed' },
      { ...base, pinned: true },
      { ...base, summary: 'A summary' },
      { ...base, contextMode: 'micro' },
      { ...base, updatedAt: base.updatedAt + 1 },
    ];
    const baseline = trackSnapshotDeep([base]);
    for (const variant of variants) {
      expect(trackSnapshotDeep([variant]), JSON.stringify(variant)).not.toBe(baseline);
    }
  });

  it('is stable for an unchanged snapshot', () => {
    const threads = [makeThread({ messages: [userMessage('m1', 'hello')] })];
    expect(trackSnapshotDeep(threads)).toBe(trackSnapshotDeep(threads));
  });
});

describe('snapshotLatestUpdatedAt', () => {
  it('takes the newest timestamp across threads, created or updated', () => {
    const snapshot = makeSnapshot({
      threads: [
        makeThread({ id: 'a', createdAt: 10, updatedAt: 20 }),
        makeThread({ id: 'b', createdAt: 90, updatedAt: 30 }),
      ],
    });
    expect(snapshotLatestUpdatedAt(snapshot)).toBe(90);
  });

  it('is 0 for an empty snapshot, so a fresh local state never beats the workspace copy', () => {
    expect(snapshotLatestUpdatedAt(makeSnapshot({ threads: [] }))).toBe(0);
  });
});

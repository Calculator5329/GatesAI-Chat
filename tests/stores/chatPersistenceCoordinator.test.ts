// The chat persistence policy: pause/resume, and the serialized workspace
// save queue. Untested until now, which is uncomfortable for the component
// that decides whether your conversations reach disk.
//
// Uses the real localStorage persistence path rather than a mock — the point
// of these tests is that a snapshot actually lands, not that a spy was called.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observable, runInAction } from 'mobx';
import { messageText, messageToolCalls } from '../../src/core/messageParts';
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
    const current = makeSnapshot();
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


describe('ChatPersistenceCoordinator — real reaction lifecycle', () => {
  const active: ChatPersistenceCoordinator[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { active.splice(0).forEach(coordinator => coordinator.dispose()); vi.useRealTimers(); });
  function fixture() {
    const state = observable({ snapshot: makeSnapshot({ threads: [makeThread({ messages: [userMessage('m1', 'before')] })] }) });
    const coordinator = new ChatPersistenceCoordinator(() => state.snapshot);
    active.push(coordinator);
    coordinator.start();
    flushPendingSnapshot();
    return { state, coordinator };
  }
  it('persists leading state immediately and trailing same-length/deep edits after 250 ms', () => {
    const { state } = fixture();
    expect(messageText(loadSnapshot()!.threads[0].messages[0])).toBe('before');
    runInAction(() => { state.snapshot.threads[0].messages[0].content = 'after!'; });
    vi.advanceTimersByTime(249);
    flushPendingSnapshot();
    expect(messageText(loadSnapshot()!.threads[0].messages[0])).toBe('before');
    vi.advanceTimersByTime(1);
    flushPendingSnapshot();
    expect(messageText(loadSnapshot()!.threads[0].messages[0])).toBe('after!');
    runInAction(() => { state.snapshot.threads[0].messages.push(userMessage('m2', 'new')); });
    vi.advanceTimersByTime(250);
    flushPendingSnapshot();
    expect(loadSnapshot()?.threads[0].messages.map(message => message.id)).toEqual(['m1', 'm2']);
  });
  it.each(['pagehide', 'beforeunload', 'dispose'])('drains latest structural and nested state on %s', (event) => {
    const { state, coordinator } = fixture();
    runInAction(() => { state.snapshot.threads[0].messages[0].content = 'pending'; });
    runInAction(() => {
      state.snapshot = makeSnapshot({ activeThreadId: 'replacement', threads: [makeThread({ id: 'replacement', messages: [userMessage('new', 'latest')] })] });
    });
    runInAction(() => { state.snapshot.threads[0].messages.push(userMessage('last', 'complete')); });
    if (event === 'dispose') coordinator.dispose();
    else window.dispatchEvent(new Event(event));
    expect(loadSnapshot()?.activeThreadId).toBe('replacement');
    expect(loadSnapshot()?.threads[0].messages.map(messageText)).toEqual(['latest', 'complete']);
    coordinator.dispose();
    coordinator.dispose();
    runInAction(() => { state.snapshot.threads[0].messages[0].content = 'after disposal'; });
    vi.advanceTimersByTime(1000);
    flushPendingSnapshot();
    expect(messageText(loadSnapshot()!.threads[0].messages[0])).toBe('latest');
  });
  it('suppresses paused trailing/unload writes to both local and workspace storage', () => {
    const { state, coordinator } = fixture();
    const workspace = deferredWorkspacePersistence();
    coordinator.attachWorkspacePersistence(workspace.persistence);
    coordinator.pause();
    runInAction(() => { state.snapshot.threads[0].messages[0].content = 'follower'; });
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(1000);
    flushPendingSnapshot();
    expect(messageText(loadSnapshot()!.threads[0].messages[0])).toBe('before');
    expect(workspace.saved).toHaveLength(1);
  });
  it('coalesces actual deep argument reads and persists the latest nested mutation', () => {
    const history = Array.from({ length: 100 }, (_, i): Message => ({
      id: `tool-${i}`, role: 'assistant', createdAt: 1,
      parts: [{ type: 'tool', call: { id: `call-${i}`, name: 'synthetic', arguments: { syntheticPayload: 'unchanged' } } }],
    }));
    const snapshot = observable(makeSnapshot({ threads: [makeThread({ messages: [...history, userMessage('stream', '')] })] }));
    const coordinator = new ChatPersistenceCoordinator(() => snapshot);
    active.push(coordinator);
    coordinator.start(); flushPendingSnapshot();
    let argumentReads = 0;
    const stringify = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation((value, ...rest) => {
      if (value && typeof value === 'object' && 'syntheticPayload' in value) argumentReads++;
      return stringify(value, ...rest);
    });
    for (let i = 0; i < 40; i++) runInAction(() => { snapshot.threads[0].messages[100].content += 'a'; });
    const first = snapshot.threads[0].messages[0];
    runInAction(() => { if (first.parts?.[0].type === 'tool' && first.parts[0].call) first.parts[0].call.arguments.syntheticPayload = 'corrected'; });
    expect(argumentReads).toBe(0);
    vi.advanceTimersByTime(250); flushPendingSnapshot();
    expect(argumentReads).toBe(100);
    expect(messageText(loadSnapshot()!.threads[0].messages.find(message => message.id === 'stream')!)).toBe('a'.repeat(40));
    expect(loadSnapshot()!.threads[0].messages.flatMap(message => message.role === 'assistant' ? messageToolCalls(message) : []).find(call => call.id === 'call-0')?.arguments).toEqual({ syntheticPayload: 'corrected' });
  });
});


describe('ChatPersistenceCoordinator — workspace pause ownership', () => {
  it('does not save on paused attach or resume, then accepts fresh scheduled state', async () => {
    let current = makeSnapshot({ activeThreadId: 'follower' });
    const coordinator = new ChatPersistenceCoordinator(() => current);
    const workspace = deferredWorkspacePersistence();
    coordinator.pause();
    coordinator.attachWorkspacePersistence(workspace.persistence);
    expect(workspace.saved).toEqual([]);
    coordinator.resume();
    expect(workspace.saved).toEqual([]);
    current = makeSnapshot({ activeThreadId: 'refreshed-leader' });
    coordinator.schedule(current);
    expect(workspace.saved.map(snapshot => snapshot.activeThreadId)).toEqual(['refreshed-leader']);
    await workspace.settleOne();
  });
  it('does not revive stale pending state if resume happens before the old write settles', async () => {
    const coordinator = new ChatPersistenceCoordinator(() => makeSnapshot({ activeThreadId: 'initial' }));
    const workspace = deferredWorkspacePersistence();
    coordinator.attachWorkspacePersistence(workspace.persistence);
    coordinator.schedule(makeSnapshot({ activeThreadId: 'stale' }));
    coordinator.pause(); coordinator.resume();
    await workspace.settleOne();
    expect(workspace.saved.map(snapshot => snapshot.activeThreadId)).toEqual(['initial']);
  });
});

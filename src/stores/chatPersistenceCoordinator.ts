// Owns the chat persistence policy in one place: the throttled localStorage
// autosave, synchronous unload flush, multi-tab pause, and the serialized
// workspace (bridge) save queue. ChatStore calls `schedule(snapshot)` and
// never juggles the three write paths itself.
//
// Lives in the store layer (not services/) because it installs a MobX
// reaction; `start()`'s autorun tracks whatever observable reads happen
// inside the injected `getSnapshot` callback — the coordinator itself holds
// no observable state.
import { autorun } from 'mobx';
import type { ChatSnapshot, Thread } from '../core/types';
import {
  flushPendingSnapshot,
  saveSnapshot,
  scheduleSaveSnapshot,
} from '../services/persistence';
import { logger } from '../services/diagnostics/logger';
import type { WorkspaceChatPersistence } from '../services/workspaceChatPersistence';

/** Throttle interval for the localStorage autosave. */
const FLUSH_MS = 250;

/**
 * Read nested thread/message fields purely to register MobX dependencies for
 * the persistence reaction. That reaction observes `snapshot` (the `threads`
 * array identity + `activeThreadId`), which does NOT track in-place edits like
 * appended messages, streamed tokens, renames, or summaries — those mutate
 * fields inside existing thread/message objects. Touching the fields here makes
 * those mutations invalidate the reaction so the throttled save runs. Returns a
 * cheap numeric signature so the reads aren't dead-code-eliminated.
 */
export function trackSnapshotDeep(threads: Thread[]): number {
  let signature = threads.length;
  for (const thread of threads) {
    signature += thread.title.length + thread.updatedAt + thread.messages.length;
    if (thread.pinned) signature += 1;
    if (thread.archived) signature += 1;
    if (thread.deletedAt != null) signature += thread.deletedAt;
    if (thread.contextMode) signature += thread.contextMode.length;
    if (thread.thinkingEffort) signature += String(thread.thinkingEffort).length;
    if (thread.autoNamed) signature += 1;
    if (thread.naming) signature += 1;
    if (thread.summary) signature += thread.summary.length;
    if (thread.summaryUpdatedAt) signature += thread.summaryUpdatedAt;
    if (thread.summaryMessageCount) signature += thread.summaryMessageCount;
    if (thread.threadContext) signature += thread.threadContext.length;
    for (const message of thread.messages) {
      signature += message.content.length + message.createdAt;
      if (message.role === 'user') {
        for (const attachment of message.attachments ?? []) {
          signature += (attachment.id?.length ?? 0) + attachment.path.length + attachment.name.length + attachment.mime.length + attachment.size;
        }
      } else {
        if (message.model) signature += message.model.length;
        if (message.preTokenLabel) signature += message.preTokenLabel.length;
        if (message.finishReason) signature += message.finishReason.length;
        for (const note of message.workNotes ?? []) signature += note.length;
        for (const call of message.toolCalls ?? []) {
          signature += call.id.length + call.name.length + JSON.stringify(call.arguments ?? {}).length;
        }
        for (const result of message.toolResults ?? []) {
          signature += result.toolCallId.length + result.toolName.length + result.content.length + result.ranAt;
          if (result.summary) signature += result.summary.length;
          if (result.errorCode) signature += result.errorCode.length;
          if (result.retryable) signature += 1;
          for (const artifact of result.artifacts ?? []) signature += JSON.stringify(artifact).length;
        }
        for (const usage of message.usage ?? []) signature += JSON.stringify(usage).length;
        for (const event of message.activityEvents ?? []) signature += event.id.length + event.verb.length + event.startedAt + (event.finishedAt ?? 0);
      }
    }
  }
  return signature;
}

/** Latest updatedAt/createdAt across a snapshot, for local-vs-workspace merges. */
export function snapshotLatestUpdatedAt(snapshot: ChatSnapshot): number {
  return snapshot.threads.reduce((latest, thread) => Math.max(latest, thread.updatedAt, thread.createdAt), 0);
}

export class ChatPersistenceCoordinator {
  private paused = false;
  private workspacePersistence: WorkspaceChatPersistence | null = null;
  private workspaceReady = false;
  private pendingWorkspaceSnap: ChatSnapshot | null = null;
  private workspaceSaveInFlight = false;
  private cleanup: (() => void) | null = null;

  private readonly getSnapshot: () => ChatSnapshot;

  constructor(getSnapshot: () => ChatSnapshot) {
    this.getSnapshot = getSnapshot;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Pause all writes (multi-tab conflict). `resume()` re-enables them. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * Install the throttled autosave reaction and synchronous unload flush.
   *
   * Leading-edge + trailing-throttle: streaming fires thousands of observable
   * mutations per turn; an unthrottled autorun would JSON.stringify every
   * thread on each one. The first save runs synchronously (so a fresh-thread
   * create persists immediately and tests can read it back without waiting),
   * then subsequent updates are coalesced to once per FLUSH_MS. Page teardown
   * flushes any pending save.
   */
  start(): void {
    let lastSaveAt = 0;
    let pendingSnap: ChatSnapshot | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (pendingSnap) {
        this.schedule(pendingSnap);
        lastSaveAt = Date.now();
        pendingSnap = null;
      }
    };
    const stopPersistAutorun = autorun(() => {
      const snap = this.getSnapshot();
      // Subscribe to nested thread/message fields. `snapshot` only tracks the
      // threads array + activeThreadId, so without this an appended message or
      // streamed token would never trigger a save (the bug where a single fresh
      // conversation was lost on reload). The throttle below still bounds how
      // often we actually write.
      trackSnapshotDeep(snap.threads);
      const now = Date.now();
      const elapsed = now - lastSaveAt;
      if (elapsed >= FLUSH_MS) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        pendingSnap = null;
        this.schedule(snap);
        lastSaveAt = now;
        return;
      }
      pendingSnap = snap;
      if (pendingTimer) return;
      pendingTimer = setTimeout(flush, FLUSH_MS - elapsed);
    });
    let removeUnloadListeners = (): void => {};
    const syncFlush = (): void => {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (pendingSnap && !this.paused) {
        saveSnapshot(pendingSnap);
        this.scheduleWorkspaceSnapshotSave(pendingSnap);
        lastSaveAt = Date.now();
        pendingSnap = null;
      }
      if (!this.paused) flushPendingSnapshot();
    };
    if (typeof window !== 'undefined') {
      // Unload paths must persist synchronously — drain the throttle queue
      // and flush any microtask-deferred write before the page tears down.
      window.addEventListener('pagehide', syncFlush);
      window.addEventListener('beforeunload', syncFlush);
      removeUnloadListeners = (): void => {
        window.removeEventListener('pagehide', syncFlush);
        window.removeEventListener('beforeunload', syncFlush);
      };
    }
    this.cleanup = (): void => {
      stopPersistAutorun();
      syncFlush();
      removeUnloadListeners();
    };
  }

  dispose(): void {
    this.cleanup?.();
    this.cleanup = null;
  }

  /** Persist a snapshot to localStorage (deferred) and the workspace queue. */
  schedule(snapshot: ChatSnapshot): void {
    if (this.paused) return;
    scheduleSaveSnapshot(snapshot);
    this.scheduleWorkspaceSnapshotSave(snapshot);
  }

  /** Begin mirroring snapshots into the workspace once the bridge is online. */
  attachWorkspacePersistence(persistence: WorkspaceChatPersistence): void {
    this.workspacePersistence = persistence;
    this.workspaceReady = true;
    this.scheduleWorkspaceSnapshotSave(this.getSnapshot());
  }

  private scheduleWorkspaceSnapshotSave(snapshot: ChatSnapshot): void {
    if (!this.workspaceReady || !this.workspacePersistence) return;
    this.pendingWorkspaceSnap = snapshot;
    if (this.workspaceSaveInFlight) return;
    this.drainWorkspaceSnapshotSave();
  }

  private drainWorkspaceSnapshotSave(): void {
    if (!this.workspacePersistence || !this.pendingWorkspaceSnap) return;
    const snap = this.pendingWorkspaceSnap;
    this.pendingWorkspaceSnap = null;
    this.workspaceSaveInFlight = true;
    void this.workspacePersistence.save(snap)
      .catch(err => {
        logger.warn('persistence', 'failed to save workspace chat snapshot', err);
      })
      .finally(() => {
        this.workspaceSaveInFlight = false;
        if (this.pendingWorkspaceSnap) this.drainWorkspaceSnapshotSave();
      });
  }
}

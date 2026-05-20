// Owns observable BridgeStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { makeAutoObservable, runInAction } from 'mobx';
import type { ActivityItem, DraftAttachment } from '../core/types';
import type { BridgeConnectionState, BridgeStatus } from '../core/workspace';
import { isWorkspacePath, resolveWorkspacePath } from '../core/workspacePaths';
import { uploadAttachment } from '../services/bridge/attachments';
import { BridgeClient, BridgeOfflineError } from '../services/bridge/client';
import { ensureDefaultWorkspaceGuide } from '../services/bridge/defaultWorkspaceGuide';
import { readAttachmentBase64 } from '../services/bridge/readAttachmentBytes';
import { openUserGuideOnFirstInstall } from '../services/bridge/userGuideInstall';
import { openExternal } from '../services/system/openExternal';

const HEALTH_URL = 'http://127.0.0.1:7331/health';
const WS_URL = 'ws://127.0.0.1:7331/ws';
const POLL_INTERVAL_MS = 5000;

interface HealthResponse {
  status: string;
  version: string;
  workspace_root: string;
  platform: string;
  allowlist: string[];
}

/**
 * Owns the bridge connection lifecycle. Polls /health every 5s; when the
 * bridge transitions offline → online, opens the WebSocket. When it
 * transitions online → offline, closes the socket and any in-flight
 * requests reject with BridgeOfflineError.
 *
 * The single BridgeClient instance is exposed so tools can call
 * `bridge.client.request(...)` directly. Tools must check
 * `bridge.isOnline` before issuing a request and translate
 * BridgeOfflineError into a friendly tool-result string.
 */
export class BridgeStore {
  state: BridgeConnectionState = 'unknown';
  version: string | undefined;
  workspaceRoot: string | undefined;
  platform: string | undefined;
  allowlist: string[] = [];
  lastSeenAt: number | undefined;
  lastError: string | undefined;
  activityEvents: ActivityItem[] = [];

  readonly client: BridgeClient;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seededWorkspaceRoot: string | undefined;
  private bridgeActivitySeq = 0;

  constructor() {
    this.client = new BridgeClient(WS_URL);
    makeAutoObservable<this, 'pollTimer' | 'seededWorkspaceRoot' | 'bridgeActivitySeq' | 'client'>(this, {
      pollTimer: false,
      seededWorkspaceRoot: false,
      bridgeActivitySeq: false,
      client: false,
    });
  }

  /** Boot the poller. Idempotent. */
  start(): void {
    if (this.pollTimer) return;
    void this.poll();
    this.pollTimer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.client.disconnect();
  }

  get isOnline(): boolean {
    return this.state === 'online';
  }

  get status(): BridgeStatus {
    return {
      state: this.state,
      version: this.version,
      workspaceRoot: this.workspaceRoot,
      platform: this.platform,
      allowlist: this.allowlist,
      lastSeenAt: this.lastSeenAt,
      lastError: this.lastError,
    };
  }

  uploadAttachment(file: File): Promise<DraftAttachment> {
    return uploadAttachment(file, this);
  }

  /**
   * Fetch a workspace file's bytes as base64. Thin pass-through to the
   * service helper; lives on the store so provider adapters and UI
   * components go through the same facade instead of importing
   * bridge internals directly.
   */
  readAttachmentBase64(workspacePath: string): Promise<{ base64: string; mime: string; size: number } | null> {
    return readAttachmentBase64(this, workspacePath);
  }

  /**
   * Open a `/workspace/...` path in the OS's default handler (browser for
   * .html, editor for .py/.md, etc.). Returns true when the request was
   * dispatched, false when the path can't be resolved (bridge offline,
   * malformed path) so the caller can show a hint instead of failing
   * silently.
   */
  async openWorkspacePath(workspacePath: string): Promise<boolean> {
    if (!isWorkspacePath(workspacePath)) return false;
    const abs = resolveWorkspacePath(workspacePath, this.workspaceRoot, this.platform);
    if (!abs) return false;
    try {
      await openExternal(abs);
      return true;
    } catch (err) {
      console.warn('[BridgeStore] openWorkspacePath failed', workspacePath, err);
      return false;
    }
  }

  /**
   * One poll cycle. On a successful health hit, opens the WebSocket if
   * not already open. On failure, marks offline and tears the socket
   * down. We swallow all network errors here — the failure mode is
   * "bridge offline", not "show the user a stack trace".
   */
  async poll(): Promise<void> {
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        // Short timeout so the poller stays snappy when the bridge is gone.
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const data = (await res.json()) as HealthResponse;
      const wasOffline = this.state !== 'online';
      const nextAllowlist = data.allowlist ?? [];
      runInAction(() => {
        // Diff-before-assign: this poll fires every 5s. Touching observable
        // fields when nothing changed re-renders every observer of the
        // bridge state — a frequent waste on a steady connection. Only
        // `lastSeenAt` (timestamp) is updated unconditionally; downstream
        // consumers don't read it.
        if (this.state !== 'online') this.state = 'online';
        if (this.version !== data.version) this.version = data.version;
        if (this.workspaceRoot !== data.workspace_root) this.workspaceRoot = data.workspace_root;
        if (this.platform !== data.platform) this.platform = data.platform;
        if (!sameStringArray(this.allowlist, nextAllowlist)) this.allowlist = nextAllowlist;
        this.lastSeenAt = Date.now();
        if (this.lastError !== undefined) this.lastError = undefined;
      });
      if (wasOffline) {
        this.emitBridgeActivity({
          state: 'done',
          verb: 'Workspace ready',
          summary: data.workspace_root,
        });
        try {
          await this.client.connect();
          if (this.seededWorkspaceRoot !== data.workspace_root) {
            await ensureDefaultWorkspaceGuide(this.client);
            await openUserGuideOnFirstInstall(this.client, path => this.openWorkspacePath(path));
            this.seededWorkspaceRoot = data.workspace_root;
          }
        } catch (err) {
          runInAction(() => {
            this.state = 'offline';
            this.lastError = (err as Error).message;
          });
          this.emitBridgeActivity({
            state: 'failed',
            verb: 'Workspace offline',
            summary: (err as Error).message,
          });
        }
      }
    } catch (err) {
      const wasOnline = this.state === 'online';
      runInAction(() => {
        this.state = 'offline';
        this.lastError = err instanceof BridgeOfflineError
          ? err.message
          : `Health check failed: ${(err as Error).message}`;
      });
      if (wasOnline) this.client.disconnect();
      if (wasOnline) {
        this.emitBridgeActivity({
          state: 'failed',
          verb: 'Workspace offline',
          summary: this.lastError,
        });
      }
    }
  }

  private emitBridgeActivity(input: Pick<ActivityItem, 'state' | 'verb' | 'summary'>): void {
    const now = Date.now();
    runInAction(() => {
      this.activityEvents.push({
        id: `bridge-${now}-${this.bridgeActivitySeq++}`,
        kind: 'bridge',
        state: input.state,
        verb: input.verb,
        summary: input.summary,
        startedAt: now,
        finishedAt: now,
      });
      if (this.activityEvents.length > 30) this.activityEvents.splice(0, this.activityEvents.length - 30);
    });
  }
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

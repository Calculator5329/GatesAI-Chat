import { makeAutoObservable, runInAction } from 'mobx';
import type { DraftAttachment } from '../core/types';
import type { BridgeConnectionState, BridgeStatus } from '../core/workspace';
import { isWorkspacePath, resolveWorkspacePath } from '../core/workspacePaths';
import { uploadAttachment } from '../services/bridge/attachments';
import { BridgeClient, BridgeOfflineError } from '../services/bridge/client';
import { readAttachmentBase64 } from '../services/bridge/readAttachmentBytes';
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

  readonly client: BridgeClient;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.client = new BridgeClient(WS_URL);
    makeAutoObservable<this, 'pollTimer' | 'client'>(this, {
      pollTimer: false,
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
      runInAction(() => {
        this.state = 'online';
        this.version = data.version;
        this.workspaceRoot = data.workspace_root;
        this.platform = data.platform;
        this.allowlist = data.allowlist ?? [];
        this.lastSeenAt = Date.now();
        this.lastError = undefined;
      });
      if (wasOffline) {
        try {
          await this.client.connect();
        } catch (err) {
          runInAction(() => {
            this.state = 'offline';
            this.lastError = (err as Error).message;
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
    }
  }
}

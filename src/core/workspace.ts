/**
 * Workspace — the chat app's view of the file/exec capabilities provided
 * by gatesai-bridge.
 *
 * Two layers:
 *
 *   1. `BridgeStatus` — connection state. The chat app polls /health
 *      periodically and exposes the result so the UI can show a status
 *      pill and tools can fail with a useful message when offline.
 *
 *   2. The op response shapes. These mirror the Go bridge's response
 *      structs 1:1 — keep them in sync. Optional fields stay optional
 *      on both sides so adding a field to the bridge's responses doesn't
 *      break older clients.
 */

export type BridgeConnectionState = 'unknown' | 'online' | 'offline' | 'incompatible';

export interface BridgeStatus {
  state: BridgeConnectionState;
  version?: string;
  workspaceRoot?: string;
  platform?: string;
  allowlist?: string[];
  /** unix ms of the last successful /health poll. */
  lastSeenAt?: number;
  /** Most recent error message, if any. */
  lastError?: string;
}

// ----- fs ops -----

export interface FsReadResp {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  size: number;
  mime: string;
}

export interface FsWriteResp {
  path: string;
  bytes: number;
}

export interface FsEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime: number;
}

export interface FsListResp {
  path: string;
  entries: FsEntry[];
  truncated?: boolean;
}

export interface FsStatResp {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  mime?: string;
}

export interface FsSearchHit {
  path: string;
  line: number;
  snippet: string;
}

export interface FsSearchResp {
  query: string;
  hits: FsSearchHit[];
  truncated?: boolean;
}

// ----- exec ops -----

export interface ExecRunResp {
  exit_code: number;
  duration_ms: number;
  stdout: string;
  stderr: string;
  truncated?: boolean;
}

export interface ExecEvent {
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface BridgeInfo {
  version: string;
  workspace_root: string;
  allowlist: string[];
  platform: string;
}

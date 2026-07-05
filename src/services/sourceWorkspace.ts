// Persists or coordinates service-level state for sourceWorkspace.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../core/runtime';

export interface SourceWorkspaceStatus {
  available: boolean;
  prepared: boolean;
  stale: boolean;
  version?: string;
  contentHash?: string;
  fileCount?: number;
  totalBytes?: number;
  bundledRoot?: string;
  workspaceRoot: string;
  sourceRoot: string;
  preparedAtUnix?: number;
  lastError?: string;
}

export interface SourceWorkspaceEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime: number;
}

export interface SourceWorkspaceList {
  path: string;
  entries: SourceWorkspaceEntry[];
  truncated: boolean;
}

export interface SourceWorkspaceRead {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface SourceWorkspaceWrite {
  path: string;
  bytes: number;
}

export interface SourceWorkspaceStat {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
}

export interface SourceWorkspaceSearchHit {
  path: string;
  line: number;
  snippet: string;
}

export interface SourceWorkspaceSearch {
  query: string;
  hits: SourceWorkspaceSearchHit[];
  truncated: boolean;
}

export type SourceChangeKind = 'added' | 'modified' | 'deleted';

export interface SourceChangedFile {
  path: string;
  change: SourceChangeKind;
  originalSize?: number;
  currentSize?: number;
  previewAvailable: boolean;
  originalContent?: string;
  currentContent?: string;
}

export interface SourceChangedFiles {
  files: SourceChangedFile[];
}

export interface SourceRevertResult {
  path: string;
  change: SourceChangeKind;
}

export async function getSourceWorkspaceStatus(): Promise<SourceWorkspaceStatus> {
  ensureTauri('read source workspace status');
  return await invoke<SourceWorkspaceStatus>('source_workspace_status');
}

export async function prepareSourceWorkspace(): Promise<SourceWorkspaceStatus> {
  ensureTauri('prepare source workspace');
  return await invoke<SourceWorkspaceStatus>('source_workspace_prepare');
}

export async function openSourceWorkspace(): Promise<void> {
  ensureTauri('open source workspace');
  await invoke('source_workspace_open');
}

export async function listSourceWorkspace(path?: string, recursive?: boolean): Promise<SourceWorkspaceList> {
  ensureTauri('list source workspace files');
  return await invoke<SourceWorkspaceList>('source_workspace_list', { path, recursive });
}

export async function readSourceWorkspace(path: string, maxChars?: number): Promise<SourceWorkspaceRead> {
  ensureTauri('read source workspace files');
  return await invoke<SourceWorkspaceRead>('source_workspace_read', { path, maxChars });
}

export async function writeSourceWorkspace(path: string, content: string): Promise<SourceWorkspaceWrite> {
  ensureTauri('write source workspace files');
  return await invoke<SourceWorkspaceWrite>('source_workspace_write', { path, content });
}

export async function statSourceWorkspace(path: string): Promise<SourceWorkspaceStat> {
  ensureTauri('stat source workspace files');
  return await invoke<SourceWorkspaceStat>('source_workspace_stat', { path });
}

export async function searchSourceWorkspace(
  query: string,
  path?: string,
  maxHits?: number,
): Promise<SourceWorkspaceSearch> {
  ensureTauri('search source workspace files');
  return await invoke<SourceWorkspaceSearch>('source_workspace_search', { query, path, maxHits });
}

export async function getSourceChangedFiles(): Promise<SourceChangedFiles> {
  ensureTauri('review source workspace changes');
  return await invoke<SourceChangedFiles>('source_changed_files');
}

export async function revertSourceFile(path: string): Promise<SourceRevertResult> {
  ensureTauri('revert source workspace file');
  return await invoke<SourceRevertResult>('source_revert_file', { path });
}

function ensureTauri(action: string): void {
  if (!isTauri()) {
    throw new Error(`Cannot ${action} outside the GatesAI desktop app.`);
  }
}

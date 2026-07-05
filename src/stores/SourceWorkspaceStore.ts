// Store facade over the desktop-only source-workspace and source-build services.
// Keeps menu and runtime-context callers free of direct Tauri service imports.
import { makeAutoObservable } from 'mobx';
import { isTauri } from '../core/runtime';
import {
  getSourceChangedFiles,
  getSourceWorkspaceStatus,
  openSourceWorkspace,
  prepareSourceWorkspace,
  revertSourceFile,
  type SourceChangedFiles,
  type SourceRevertResult,
  type SourceWorkspaceStatus,
} from '../services/sourceWorkspace';
import {
  clearSourceBuild,
  getSourceBuildStatus,
  startSourceBuild,
  type SourceBuildCommand,
  type SourceBuildStatus,
} from '../services/sourceBuild';
import { openExternal } from '../services/system/openExternal';
import { diffLines, type LineDiffRow } from '../services/diff/lineDiff';
import { lastBuildForRuntime, lastTestForRuntime } from './sourceWorkspaceSelectors';

export type {
  SourceChangedFile,
  SourceChangedFiles,
  SourceChangeKind,
  SourceRevertResult,
  SourceWorkspaceStatus,
} from '../services/sourceWorkspace';
export type { SourceBuildCommand, SourceBuildStatus } from '../services/sourceBuild';
export type { LineDiffRow } from '../services/diff/lineDiff';

export interface SourceWorkspaceRuntimeSnapshot {
  prepared: boolean;
  changedFileCount?: number;
  latestChangeAtUnix?: number;
  lastBuildStatus?: SourceBuildStatus['status'];
  lastBuildFinishedAtUnix?: number;
  lastBuildStartedAtUnix?: number;
  lastTestStatus?: SourceBuildStatus['status'];
  lastTestFinishedAtUnix?: number;
  lastTestStartedAtUnix?: number;
}

export class SourceWorkspaceStore {
  statusSnapshot: SourceWorkspaceStatus | null = null;
  changedFilesSnapshot: SourceChangedFiles | null = null;
  buildSnapshot: SourceBuildStatus | null = null;
  runtimeRefreshInFlight = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  async status(): Promise<SourceWorkspaceStatus> {
    const status = await getSourceWorkspaceStatus();
    this.statusSnapshot = status;
    return status;
  }

  async prepare(): Promise<SourceWorkspaceStatus> {
    const status = await prepareSourceWorkspace();
    this.statusSnapshot = status;
    await this.refreshChangesIfPrepared(status);
    return status;
  }

  open(): Promise<void> {
    return openSourceWorkspace();
  }

  async changedFiles(): Promise<SourceChangedFiles> {
    const files = await getSourceChangedFiles();
    this.changedFilesSnapshot = files;
    return files;
  }

  async revertFile(path: string): Promise<SourceRevertResult> {
    const result = await revertSourceFile(path);
    await this.changedFiles();
    return result;
  }

  async buildStatus(): Promise<SourceBuildStatus> {
    const status = await getSourceBuildStatus();
    this.buildSnapshot = status;
    return status;
  }

  async startBuild(command: SourceBuildCommand): Promise<SourceBuildStatus> {
    const status = await startSourceBuild(command);
    this.buildSnapshot = status;
    return status;
  }

  async clearBuild(): Promise<SourceBuildStatus> {
    const status = await clearSourceBuild();
    this.buildSnapshot = status;
    return status;
  }

  async openOutputFolder(artifactPath: string): Promise<void> {
    await openExternal(parentPath(artifactPath));
  }

  diffRowsForFile(file: { originalContent?: string; currentContent?: string }): LineDiffRow[] {
    return diffLines(file.originalContent ?? '', file.currentContent ?? '');
  }

  get runtimeSnapshot(): SourceWorkspaceRuntimeSnapshot | null {
    if (!this.statusSnapshot?.prepared || this.statusSnapshot.stale) return null;
    const lastBuild = lastBuildForRuntime(this.buildSnapshot);
    const lastTest = lastTestForRuntime(this.buildSnapshot);
    return {
      prepared: true,
      changedFileCount: this.changedFilesSnapshot?.files.length,
      latestChangeAtUnix: this.changedFilesSnapshot?.latestChangeAtUnix,
      lastBuildStatus: lastBuild?.status,
      lastBuildFinishedAtUnix: lastBuild?.finishedAtUnix,
      lastBuildStartedAtUnix: lastBuild?.startedAtUnix,
      lastTestStatus: lastTest?.status,
      lastTestFinishedAtUnix: lastTest?.finishedAtUnix,
      lastTestStartedAtUnix: lastTest?.startedAtUnix,
    };
  }

  async refreshRuntimeContext(): Promise<void> {
    if (!isTauri() || this.runtimeRefreshInFlight) return;
    this.runtimeRefreshInFlight = true;
    try {
      const status = await this.status();
      await Promise.all([
        this.refreshChangesIfPrepared(status),
        this.buildStatus().catch(() => undefined),
      ]);
    } finally {
      this.runtimeRefreshInFlight = false;
    }
  }

  private async refreshChangesIfPrepared(status: SourceWorkspaceStatus): Promise<void> {
    if (!status.available || !status.prepared || status.stale) {
      this.changedFilesSnapshot = null;
      return;
    }
    await this.changedFiles().catch(() => undefined);
  }
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return path;
  return path.slice(0, index);
}

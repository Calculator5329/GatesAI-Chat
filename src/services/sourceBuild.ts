import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../core/runtime';

export type SourceBuildCommand = 'install' | 'test' | 'build' | 'package';
export type SourceBuildStatusKind = 'idle' | 'running' | 'succeeded' | 'failed' | 'interrupted';
export type SourceBuildJobKind = 'build' | 'test';
export type SourceBuildStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface SourceBuildStepStatusSnapshot {
  id: string;
  label: string;
  cmdline: string;
  status: SourceBuildStepStatus;
  startedAtUnix?: number;
  finishedAtUnix?: number;
  exitCode?: number;
}

export interface SourceBuildJobSummary {
  jobKind: SourceBuildJobKind;
  command: SourceBuildCommand;
  status: SourceBuildStatusKind;
  startedAtUnix?: number;
  finishedAtUnix?: number;
  exitCode?: number;
  steps: SourceBuildStepStatusSnapshot[];
  failureTail?: string;
}

export interface SourceBuildStatus {
  status: SourceBuildStatusKind;
  jobKind?: SourceBuildJobKind;
  command?: SourceBuildCommand;
  cmdline?: string;
  sourceRoot?: string;
  startedAtUnix?: number;
  finishedAtUnix?: number;
  exitCode?: number;
  steps: SourceBuildStepStatusSnapshot[];
  logs: string[];
  lastError?: string;
  installerPath?: string;
  installerBytes?: number;
  lastBuild?: SourceBuildJobSummary;
  lastTest?: SourceBuildJobSummary;
}

export async function getSourceBuildStatus(): Promise<SourceBuildStatus> {
  ensureTauri('read source build status');
  return await invoke<SourceBuildStatus>('source_build_status');
}

export async function startSourceBuild(command: SourceBuildCommand): Promise<SourceBuildStatus> {
  ensureTauri('start source build');
  return await invoke<SourceBuildStatus>('source_build_start', { command });
}

export async function clearSourceBuild(): Promise<SourceBuildStatus> {
  ensureTauri('clear source build status');
  return await invoke<SourceBuildStatus>('source_build_clear');
}

function ensureTauri(action: string): void {
  if (!isTauri()) {
    throw new Error(`Cannot ${action} outside the GatesAI desktop app.`);
  }
}

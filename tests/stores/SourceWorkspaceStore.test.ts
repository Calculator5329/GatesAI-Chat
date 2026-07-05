import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceWorkspaceStore } from '../../src/stores/SourceWorkspaceStore';
import {
  getSourceChangedFiles,
  getSourceWorkspaceStatus,
} from '../../src/services/sourceWorkspace';
import {
  getSourceBuildStatus,
  startSourceBuild,
} from '../../src/services/sourceBuild';

vi.mock('../../src/core/runtime', () => ({
  isTauri: () => true,
}));

vi.mock('../../src/services/sourceWorkspace', () => ({
  getSourceWorkspaceStatus: vi.fn(),
  prepareSourceWorkspace: vi.fn(),
  openSourceWorkspace: vi.fn(),
  getSourceChangedFiles: vi.fn(),
  revertSourceFile: vi.fn(),
}));

vi.mock('../../src/services/sourceBuild', () => ({
  clearSourceBuild: vi.fn(),
  getSourceBuildStatus: vi.fn(),
  startSourceBuild: vi.fn(),
}));

vi.mock('../../src/services/system/openExternal', () => ({
  openExternal: vi.fn(),
}));

describe('SourceWorkspaceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks test job stream state and exposes last test in runtime snapshot', async () => {
    vi.mocked(getSourceWorkspaceStatus).mockResolvedValue({
      available: true,
      prepared: true,
      stale: false,
      workspaceRoot: 'C:/data/source-workspace',
      sourceRoot: 'C:/data/source-workspace/current',
    });
    vi.mocked(getSourceChangedFiles).mockResolvedValue({
      files: [],
      latestChangeAtUnix: 1_800_000_000,
    });
    vi.mocked(getSourceBuildStatus).mockResolvedValue({
      status: 'running',
      jobKind: 'test',
      command: 'test',
      cmdline: 'npm.cmd ci && npm.cmd test && npm.cmd run typecheck && npm.cmd run lint',
      startedAtUnix: 1_800_000_010,
      steps: [
        { id: 'ci', label: 'npm ci', cmdline: 'npm.cmd ci', status: 'skipped', exitCode: 0 },
        { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'running', startedAtUnix: 1_800_000_010 },
        { id: 'typecheck', label: 'typecheck', cmdline: 'npm.cmd run typecheck', status: 'pending' },
        { id: 'lint', label: 'lint', cmdline: 'npm.cmd run lint', status: 'pending' },
      ],
      logs: ['[stdout] running tests'],
    });
    vi.mocked(startSourceBuild).mockResolvedValue({
      status: 'succeeded',
      jobKind: 'test',
      command: 'test',
      cmdline: 'npm.cmd ci && npm.cmd test && npm.cmd run typecheck && npm.cmd run lint',
      startedAtUnix: 1_800_000_010,
      finishedAtUnix: 1_800_000_040,
      exitCode: 0,
      steps: [
        { id: 'ci', label: 'npm ci', cmdline: 'npm.cmd ci', status: 'skipped', exitCode: 0 },
        { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'succeeded', exitCode: 0 },
        { id: 'typecheck', label: 'typecheck', cmdline: 'npm.cmd run typecheck', status: 'succeeded', exitCode: 0 },
        { id: 'lint', label: 'lint', cmdline: 'npm.cmd run lint', status: 'succeeded', exitCode: 0 },
      ],
      logs: ['[stdout] ok'],
      lastTest: {
        jobKind: 'test',
        command: 'test',
        status: 'succeeded',
        startedAtUnix: 1_800_000_010,
        finishedAtUnix: 1_800_000_040,
        exitCode: 0,
        steps: [],
      },
    });

    const store = new SourceWorkspaceStore();
    await store.refreshRuntimeContext();

    expect(store.buildSnapshot?.status).toBe('running');
    expect(store.runtimeSnapshot?.latestChangeAtUnix).toBe(1_800_000_000);

    await store.startBuild('test');

    expect(startSourceBuild).toHaveBeenCalledWith('test');
    expect(store.runtimeSnapshot?.lastTestStatus).toBe('succeeded');
    expect(store.runtimeSnapshot?.lastTestFinishedAtUnix).toBe(1_800_000_040);
  });
});

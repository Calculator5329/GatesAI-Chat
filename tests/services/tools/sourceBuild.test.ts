import { describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import { formatStatus, sourceBuildTool } from '../../../src/services/tools/sourceBuild';
import {
  clearSourceBuild,
  getSourceBuildStatus,
  startSourceBuild,
} from '../../../src/services/sourceBuild';

vi.mock('../../../src/services/sourceBuild', () => ({
  getSourceBuildStatus: vi.fn(),
  startSourceBuild: vi.fn(),
  clearSourceBuild: vi.fn(),
}));

describe('source_build tool', () => {
  it('validates start requires a command', () => {
    expect(toolRegistry.validateCallDetailed('source_build', {}).errorCode).toBe('missing_required_argument');
    expect(toolRegistry.validateCallDetailed('source_build', { action: 'start' }).content)
      .toContain('`command` is required');
    expect(toolRegistry.validateCallDetailed('source_build', { action: 'start', command: 'test' }).ok).toBe(true);
    expect(toolRegistry.validateCallDetailed('source_build', { action: 'start', command: 'deploy' }).errorCode)
      .toBe('invalid_enum_value');
  });

  it('formats status, start, and clear output', async () => {
    vi.mocked(getSourceBuildStatus).mockResolvedValueOnce({
      status: 'idle',
      steps: [],
      logs: [],
    });
    vi.mocked(startSourceBuild).mockResolvedValueOnce({
      status: 'running',
      jobKind: 'test',
      command: 'test',
      cmdline: 'npm.cmd ci && npm.cmd test && npm.cmd run typecheck && npm.cmd run lint',
      sourceRoot: 'C:/App/source-workspace/current',
      startedAtUnix: 1_800_000_000,
      steps: [
        { id: 'ci', label: 'npm ci', cmdline: 'npm.cmd ci', status: 'skipped', exitCode: 0 },
        { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'running', startedAtUnix: 1_800_000_000 },
        { id: 'typecheck', label: 'typecheck', cmdline: 'npm.cmd run typecheck', status: 'pending' },
        { id: 'lint', label: 'lint', cmdline: 'npm.cmd run lint', status: 'pending' },
      ],
      logs: ['$ npm.cmd test', '[stdout] running'],
    });
    vi.mocked(clearSourceBuild).mockResolvedValueOnce({
      status: 'idle',
      steps: [],
      logs: [],
    });

    expect(await sourceBuildTool.execute({ action: 'status' }, {} as never)).toContain('status: idle');
    expect(await sourceBuildTool.execute({ action: 'start', command: 'test' }, {} as never))
      .toContain('typecheck: pending');
    expect(await sourceBuildTool.execute({ action: 'clear' }, {} as never)).toContain('status: idle');
  });

  it('formats failed test summary with capped failure tail', () => {
    const longTail = `${'x'.repeat(9_000)}failure`;
    const formatted = formatStatus({
      status: 'failed',
      jobKind: 'test',
      command: 'test',
      cmdline: 'npm.cmd ci && npm.cmd test && npm.cmd run typecheck && npm.cmd run lint',
      startedAtUnix: 1,
      finishedAtUnix: 2,
      exitCode: 1,
      steps: [
        { id: 'ci', label: 'npm ci', cmdline: 'npm.cmd ci', status: 'skipped', exitCode: 0 },
        { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'failed', exitCode: 1 },
      ],
      logs: ['failure'],
      lastTest: {
        jobKind: 'test',
        command: 'test',
        status: 'failed',
        startedAtUnix: 1,
        finishedAtUnix: 2,
        exitCode: 1,
        steps: [
          { id: 'ci', label: 'npm ci', cmdline: 'npm.cmd ci', status: 'skipped', exitCode: 0 },
          { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'failed', exitCode: 1 },
        ],
        failureTail: longTail,
      },
    });

    expect(formatted).toContain('--- last test ---');
    expect(formatted).toContain('failure');
    expect(formatted).not.toContain('x'.repeat(8_100));
    const content = sourceBuildTool.def.description;
    expect(content).toContain('edit the source copy');
    expect(content).toContain('run source_build start/test');
    expect(content).toContain('then tell the user it is ready to build');
    expect(sourceBuildTool.meta?.resultPolicy?.maxChars).toBe(12_000);
    expect(
      sourceBuildTool.meta?.validate?.({ action: 'start', command: 'test' }),
    ).toBeNull();
    expect(
      sourceBuildTool.meta?.validate?.({ action: 'start' })?.summary,
    ).toContain('`command` is required');
    expect(
      sourceBuildTool.meta?.isReadOnly?.({ action: 'status' }),
    ).toBe(true);
  });

  it('is selected for installer regeneration turns', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'regenerate the installer from the duplicate codebase',
      bridgeOnline: false,
    }).map(tool => tool.name);

    expect(names).toContain('source_build');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import { sourceBuildTool } from '../../../src/services/tools/sourceBuild';
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
      logs: [],
    });
    vi.mocked(startSourceBuild).mockResolvedValueOnce({
      status: 'running',
      command: 'test',
      cmdline: 'npm.cmd test',
      sourceRoot: 'C:/App/source-workspace/current',
      startedAtUnix: 1_800_000_000,
      logs: ['$ npm.cmd test', '[stdout] running'],
    });
    vi.mocked(clearSourceBuild).mockResolvedValueOnce({
      status: 'idle',
      logs: [],
    });

    expect(await sourceBuildTool.execute({ action: 'status' }, {} as never)).toContain('status: idle');
    expect(await sourceBuildTool.execute({ action: 'start', command: 'test' }, {} as never))
      .toContain('cmdline: npm.cmd test');
    expect(await sourceBuildTool.execute({ action: 'clear' }, {} as never)).toContain('status: idle');
  });

  it('is selected for installer regeneration turns', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'regenerate the installer from the duplicate codebase',
      bridgeOnline: false,
    }).map(tool => tool.name);

    expect(names).toContain('source_build');
  });
});

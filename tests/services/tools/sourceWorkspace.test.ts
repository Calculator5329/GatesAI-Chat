import { describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import { sourceWorkspaceTool } from '../../../src/services/tools/sourceWorkspace';
import {
  getSourceWorkspaceStatus,
  listSourceWorkspace,
  prepareSourceWorkspace,
  readSourceWorkspace,
  searchSourceWorkspace,
  writeSourceWorkspace,
} from '../../../src/services/sourceWorkspace';

vi.mock('../../../src/services/sourceWorkspace', () => ({
  getSourceWorkspaceStatus: vi.fn(),
  prepareSourceWorkspace: vi.fn(),
  openSourceWorkspace: vi.fn(),
  listSourceWorkspace: vi.fn(),
  readSourceWorkspace: vi.fn(),
  writeSourceWorkspace: vi.fn(),
  statSourceWorkspace: vi.fn(),
  searchSourceWorkspace: vi.fn(),
}));

describe('source_workspace tool', () => {
  it('validates action-specific arguments', () => {
    expect(toolRegistry.validateCallDetailed('source_workspace', {}).errorCode).toBe('missing_required_argument');
    expect(toolRegistry.validateCallDetailed('source_workspace', { action: 'read' }).content)
      .toContain('`path` is required');
    expect(toolRegistry.validateCallDetailed('source_workspace', { action: 'write', path: 'src/a.ts' }).content)
      .toContain('`content` is required');
    expect(toolRegistry.validateCallDetailed('source_workspace', { action: 'search' }).content)
      .toContain('`query` is required');
    expect(toolRegistry.validateCallDetailed('source_workspace', { action: 'read', path: 'src/a.ts' }).ok).toBe(true);
  });

  it('formats status and prepare output', async () => {
    vi.mocked(getSourceWorkspaceStatus).mockResolvedValueOnce({
      available: true,
      prepared: false,
      stale: false,
      version: '3.4.0',
      contentHash: 'sha256:abc',
      fileCount: 10,
      totalBytes: 100,
      workspaceRoot: 'C:/App/source-workspace',
      sourceRoot: 'C:/App/source-workspace/current',
    });
    vi.mocked(prepareSourceWorkspace).mockResolvedValueOnce({
      available: true,
      prepared: true,
      stale: false,
      version: '3.4.0',
      contentHash: 'sha256:abc',
      fileCount: 10,
      totalBytes: 100,
      workspaceRoot: 'C:/App/source-workspace',
      sourceRoot: 'C:/App/source-workspace/current',
      preparedAtUnix: 1_800_000_000,
    });

    const status = await sourceWorkspaceTool.execute({ action: 'status' }, {} as never);
    const prepared = await sourceWorkspaceTool.execute({ action: 'prepare' }, {} as never);

    expect(status).toContain('prepared: false');
    expect(status).toContain('content_hash: sha256:abc');
    expect(prepared).toContain('prepared: true');
    expect(prepared).toContain('prepared_at:');
  });

  it('formats list, read, write, and search actions', async () => {
    vi.mocked(listSourceWorkspace).mockResolvedValueOnce({
      path: 'source://src',
      truncated: false,
      entries: [
        { path: 'source://src/app', name: 'app', kind: 'dir', mtime: 1 },
        { path: 'source://src/main.tsx', name: 'main.tsx', kind: 'file', size: 42, mtime: 1 },
      ],
    });
    vi.mocked(readSourceWorkspace).mockResolvedValueOnce({
      path: 'source://src/main.tsx',
      content: 'hello',
      size: 5,
      truncated: true,
    });
    vi.mocked(writeSourceWorkspace).mockResolvedValueOnce({
      path: 'source://src/main.tsx',
      bytes: 5,
    });
    vi.mocked(searchSourceWorkspace).mockResolvedValueOnce({
      query: 'hello',
      truncated: false,
      hits: [{ path: 'source://src/main.tsx', line: 1, snippet: 'hello' }],
    });

    expect(await sourceWorkspaceTool.execute({ action: 'list', path: 'src' }, {} as never))
      .toContain('source://src/main.tsx');
    expect(await sourceWorkspaceTool.execute({ action: 'read', path: 'src/main.tsx' }, {} as never))
      .toContain('truncated: true');
    expect(await sourceWorkspaceTool.execute({ action: 'write', path: 'src/main.tsx', content: 'hello' }, {} as never))
      .toContain('Wrote 5 bytes');
    expect(await sourceWorkspaceTool.execute({ action: 'search', query: 'hello' }, {} as never))
      .toContain('source://src/main.tsx:1: hello');
  });

  it('is selected for self-update and source-code turns', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'update the GatesAI source workspace and regenerate the installer',
      bridgeOnline: false,
    }).map(tool => tool.name);

    expect(names).toContain('source_workspace');
    expect(names).toContain('source_build');
  });
});

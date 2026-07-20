import { describe, expect, it, vi } from 'vitest';
import { libraryTool } from '../../../src/services/tools/library';
import type { ToolContext } from '../../../src/services/tools/types';

const document = {
  id: 'db-main',
  path: '/workspace/data/main.sqlite',
  title: 'Main database',
  kind: 'database' as const,
  text: '# Database schema\n\nCREATE TABLE projects (id TEXT);',
  updatedAt: 2,
};
const library = {
  sources: [{
    id: document.id,
    path: document.path,
    title: document.title,
    kind: document.kind,
    enabled: true,
    addedAt: 1,
    status: 'ready' as const,
  }],
  readyCount: 1,
  documents: new Map([[document.id, document]]),
};

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return { library, threadId: 't1', ...overrides } as unknown as ToolContext;
}

describe('library tool', () => {
  it('lists approved sources and exposes database schema without rows', async () => {
    const listed = await libraryTool.execute({ action: 'list_sources' }, context());
    const schema = await libraryTool.execute({ action: 'database_schema', source_id: 'db-main' }, context());

    expect(listed).toContain('path: /workspace/data/main.sqlite');
    expect(schema).toContain('CREATE TABLE projects');
    expect(schema).not.toContain('SELECT *');
  });

  it('keeps semantic search library-scoped and bounded', async () => {
    const recallLibrary = vi.fn(async () => 'library match');
    const result = await libraryTool.execute(
      { action: 'search', query: 'project owner', limit: 100 },
      context({ rag: { active: true, recall: vi.fn(), recallLibrary } }),
    );

    expect(result).toBe('library match');
    expect(recallLibrary).toHaveBeenCalledWith('project owner', 10);
  });
});

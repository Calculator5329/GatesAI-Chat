import { describe, expect, it, vi } from 'vitest';
import { loadArtifactReadmeInstructions } from '../../../src/services/chat/artifactReadmeContext';

describe('artifact README context loading', () => {
  it('loads sorted README files under artifacts and skips non-readme files', async () => {
    const request = vi.fn(async (op: string, data: unknown) => {
      if (op === 'fs.list') {
        return {
          path: '/workspace/artifacts',
          entries: [
            { kind: 'file', path: '/workspace/artifacts/z/README.md', name: 'README.md', mtime: 1 },
            { kind: 'file', path: '/workspace/artifacts/z/output.json', name: 'output.json', mtime: 1 },
            { kind: 'file', path: '/workspace/artifacts/a/readme.md', name: 'readme.md', mtime: 1 },
          ],
        };
      }
      const path = (data as { path: string }).path;
      return { path, encoding: 'utf8', content: ` instructions for ${path} `, size: 10, mime: 'text/markdown' };
    });

    const client = {
      request: request as unknown as <T = unknown>(op: string, data: unknown) => Promise<T>,
    };

    const result = await loadArtifactReadmeInstructions({ client }, new AbortController().signal);

    expect(request).toHaveBeenCalledWith('fs.list', { path: '/workspace/artifacts', recursive: true });
    expect(result).toContain('[/workspace/artifacts/a/readme.md]');
    expect(result).toContain('[/workspace/artifacts/z/README.md]');
    expect(result).not.toContain('output.json');
    expect(result.indexOf('/workspace/artifacts/a/readme.md')).toBeLessThan(result.indexOf('/workspace/artifacts/z/README.md'));
  });
});

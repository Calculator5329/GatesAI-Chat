import { describe, expect, it } from 'vitest';
import { ensureDefaultWorkspaceGuide } from '../../src/services/bridge/defaultWorkspaceGuide';

describe('ensureDefaultWorkspaceGuide', () => {
  it('creates default workspace folders, README, and AI operating context', async () => {
    const calls: Array<{ op: string; data: unknown }> = [];
    const existing = new Set<string>();
    const client = {
      async request<T = unknown>(op: string, data: unknown): Promise<T> {
        calls.push({ op, data });
        if (op === 'fs.stat') {
          const path = (data as { path: string }).path;
          if (existing.has(path)) return { path, kind: 'file' } as T;
          throw new Error('not found');
        }
        if (op === 'fs.write') {
          existing.add((data as { path: string }).path);
        }
        return {} as T;
      },
    };

    await ensureDefaultWorkspaceGuide(client);

    expect(calls).toEqual(expect.arrayContaining([
      { op: 'fs.mkdir', data: { path: '/workspace/notes' } },
      { op: 'fs.mkdir', data: { path: '/workspace/artifacts' } },
      { op: 'fs.mkdir', data: { path: '/workspace/attachments' } },
      expect.objectContaining({
        op: 'fs.write',
        data: expect.objectContaining({
          path: '/workspace/README.md',
          content: expect.stringContaining('/workspace/notes/GatesAI-AI-Operating-Context.md'),
        }),
      }),
      expect.objectContaining({
        op: 'fs.write',
        data: expect.objectContaining({
          path: '/workspace/.gitignore',
          content: expect.stringContaining('Thumbs.db'),
        }),
      }),
      expect.objectContaining({
        op: 'fs.write',
        data: expect.objectContaining({
          path: '/workspace/notes/GatesAI-AI-Operating-Context.md',
          content: expect.stringContaining('GatesAI AI Operating Context'),
        }),
      }),
      { op: 'exec.run', data: { cmd: 'git', args: ['init'], timeout_ms: 10000 } },
    ]));
  });

  it('does not overwrite an existing root README', async () => {
    const writes: unknown[] = [];
    const client = {
      async request<T = unknown>(op: string, data: unknown): Promise<T> {
        if (op === 'fs.stat' && (data as { path: string }).path === '/workspace/README.md') {
          return { path: '/workspace/README.md', kind: 'file' } as T;
        }
        if (op === 'fs.stat') throw new Error('not found');
        if (op === 'fs.write') writes.push(data);
        return {} as T;
      },
    };

    await ensureDefaultWorkspaceGuide(client);

    expect(writes).not.toContainEqual(expect.objectContaining({ path: '/workspace/README.md' }));
    expect(writes).toContainEqual(expect.objectContaining({ path: '/workspace/notes/GatesAI-AI-Operating-Context.md' }));
  });
});

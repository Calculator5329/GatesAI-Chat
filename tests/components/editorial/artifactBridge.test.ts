import { describe, expect, it, vi } from 'vitest';
import { handleArtifactBridgeRequest } from '../../../src/components/editorial/artifactBridge';

function makeFakeBridge(opts: { online?: boolean } = {}) {
  const calls: { op: string; data: unknown }[] = [];
  const files = new Map<string, string>();
  const client = {
    request: vi.fn(async (op: string, data: unknown) => {
      calls.push({ op, data });
      const d = data as { path?: string; content?: string };
      if (op === 'fs.write') {
        files.set(d.path!, d.content!);
        return { path: d.path, bytes: d.content!.length };
      }
      if (op === 'fs.read') {
        const c = files.get(d.path!);
        if (c == null) throw new Error('ENOENT');
        return { path: d.path, content: c, encoding: 'utf8', mime: 'text/plain', size: c.length };
      }
      if (op === 'fs.list') {
        return {
          path: d.path,
          entries: [
            { path: `${d.path}/a.txt`, name: 'a.txt', kind: 'file', size: 1, mtime: 0 },
            { path: `${d.path}/b.txt`, name: 'b.txt', kind: 'file', size: 1, mtime: 0 },
          ],
          truncated: false,
        };
      }
      throw new Error(`unexpected op ${op}`);
    }),
  };
  return { calls, files, bridge: { isOnline: opts.online ?? true, client } as any };
}

describe('handleArtifactBridgeRequest', () => {
  it('readFile resolves with file content and preserves id', async () => {
    const { bridge, files } = makeFakeBridge();
    files.set('/workspace/notes/x.md', 'hello');
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r1', op: 'readFile', args: ['/workspace/notes/x.md'],
    });
    expect(resp).toEqual({ id: 'r1', ok: true, value: 'hello' });
  });

  it('listDir returns array of paths', async () => {
    const { bridge } = makeFakeBridge();
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r2', op: 'listDir', args: ['/workspace/artifacts/foo/data'],
    });
    expect(resp.id).toBe('r2');
    expect(resp.ok).toBe(true);
    expect(resp.value).toEqual([
      '/workspace/artifacts/foo/data/a.txt',
      '/workspace/artifacts/foo/data/b.txt',
    ]);
  });

  it('listDir rejects empty path', async () => {
    const { bridge } = makeFakeBridge();
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r2e', op: 'listDir', args: [''],
    });
    expect(resp.id).toBe('r2e');
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/path required/);
  });

  it('writeFile inside artifact data dir succeeds with no value', async () => {
    const { bridge, files } = makeFakeBridge();
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r3', op: 'writeFile', args: ['/workspace/artifacts/foo/data/state.json', '{}'],
    });
    expect(resp).toEqual({ id: 'r3', ok: true });
    expect(files.get('/workspace/artifacts/foo/data/state.json')).toBe('{}');
  });

  it('writeFile outside data dir is rejected', async () => {
    const { bridge } = makeFakeBridge();
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r4', op: 'writeFile', args: ['/workspace/notes/foo.md', 'hi'],
    });
    expect(resp.id).toBe('r4');
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/writes restricted/);
  });

  it('unknown op returns error', async () => {
    const { bridge } = makeFakeBridge();
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r5', op: 'nope' as any, args: [],
    });
    expect(resp.id).toBe('r5');
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/unknown op/);
  });

  it('returns offline error when bridge is offline', async () => {
    const { bridge } = makeFakeBridge({ online: false });
    const resp = await handleArtifactBridgeRequest('foo', bridge, {
      id: 'r6', op: 'readFile', args: ['/workspace/x'],
    });
    expect(resp.id).toBe('r6');
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/offline/);
  });

  it('returns offline error when bridge is undefined', async () => {
    const resp = await handleArtifactBridgeRequest('foo', undefined, {
      id: 'r7', op: 'readFile', args: ['/workspace/x'],
    });
    expect(resp).toEqual({ id: 'r7', ok: false, error: expect.stringMatching(/offline/) });
  });
});

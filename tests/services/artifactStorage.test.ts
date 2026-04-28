import { describe, expect, it, vi } from 'vitest';
import { ArtifactStorage } from '../../src/services/artifactStorage';
import type { ArtifactMeta } from '../../src/core/artifacts';
import type { BridgeClientFacade, BridgeFacade } from '../../src/services/tools/types';

function makeFakeBridge() {
  const calls: { op: string; data: unknown }[] = [];
  const files = new Map<string, string>();
  const client = {
    request: vi.fn(async (op: string, data: unknown) => {
      calls.push({ op, data });
      const d = data as { path?: string; content?: string };
      if (op === 'fs.write') { files.set(d.path!, d.content!); return { path: d.path, bytes: d.content!.length }; }
      if (op === 'fs.read')  { const c = files.get(d.path!); if (c == null) throw new Error('ENOENT'); return { path: d.path, content: c, mime: 'text/plain', size: c.length }; }
      if (op === 'fs.mkdir') return { path: d.path };
      if (op === 'fs.list')  return { path: d.path, entries: [], truncated: false };
      throw new Error(`unexpected op ${op}`);
    }),
  } as BridgeClientFacade;
  const bridge: BridgeFacade = {
    isOnline: true,
    client,
    readAttachmentBase64: vi.fn(async () => null),
  };
  return { calls, files, bridge };
}

describe('ArtifactStorage', () => {
  it('writeNewVersion creates folder, writes html and meta', async () => {
    const { bridge, files, calls } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    const meta: ArtifactMeta = {
      id: 'foo-abc123', title: 'Foo', slug: 'foo',
      createdAt: 1, updatedAt: 1, threadId: 't1',
      currentVersion: 1, versions: [{ version: 1, createdAt: 1, size: 12 }],
    };
    await storage.writeNewVersion(meta, '<html>hi</html>');
    expect(files.get('/workspace/artifacts/foo-abc123/v1.html')).toBe('<html>hi</html>');
    const persistedMeta = JSON.parse(files.get('/workspace/artifacts/foo-abc123/meta.json')!);
    expect(persistedMeta.id).toBe('foo-abc123');
    expect(calls.some(c => c.op === 'fs.mkdir' && (c.data as { path?: string }).path === '/workspace/artifacts/foo-abc123/data')).toBe(true);
  });

  it('readMeta parses meta.json or returns null if missing', async () => {
    const { bridge, files } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    expect(await storage.readMeta('missing')).toBeNull();
    files.set('/workspace/artifacts/x/meta.json', JSON.stringify({ id: 'x', title: 'X', slug: 'x', createdAt: 0, updatedAt: 0, threadId: 't', currentVersion: 1, versions: [] }));
    const got = await storage.readMeta('x');
    expect(got?.id).toBe('x');
  });

  it('readVersion returns html for a given version', async () => {
    const { bridge, files } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    files.set('/workspace/artifacts/x/v2.html', '<p>v2</p>');
    expect(await storage.readVersion('x', 2)).toBe('<p>v2</p>');
  });
});

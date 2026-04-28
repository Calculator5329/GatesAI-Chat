import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../src/stores/ArtifactStore';
import type { ArtifactStorage } from '../../src/services/artifactStorage';
import type { ArtifactMeta } from '../../src/core/artifacts';

function makeFakeStorage() {
  const writes: { meta: ArtifactMeta; html: string }[] = [];
  const metas = new Map<string, ArtifactMeta>();
  const versions = new Map<string, string>();
  const storage = {
    writeNewVersion: async (meta: ArtifactMeta, html: string) => {
      writes.push({ meta, html });
      metas.set(meta.id, JSON.parse(JSON.stringify(meta)));
      versions.set(`${meta.id}:${meta.currentVersion}`, html);
    },
    readMeta: async (id: string) => metas.get(id) ?? null,
    readVersion: async (id: string, v: number) => versions.get(`${id}:${v}`) ?? null,
  } as unknown as ArtifactStorage;
  return { storage, writes, metas, versions };
}

describe('ArtifactStore', () => {
  it('create assigns an id and writes v1', async () => {
    const { storage, writes } = makeFakeStorage();
    const store = new ArtifactStore(storage);
    const meta = await store.create({ title: 'Hi', html: '<p>1</p>', threadId: 't1', originMessageId: 'm1' });
    expect(meta.currentVersion).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].html).toBe('<p>1</p>');
    expect(store.findById(meta.id)?.title).toBe('Hi');
    expect(await store.getHtml(meta.id, 1)).toBe('<p>1</p>');
  });

  it('update bumps version and persists, keeping prior versions', async () => {
    const { storage } = makeFakeStorage();
    const store = new ArtifactStore(storage);
    const a = await store.create({ title: 'X', html: 'v1', threadId: 't' });
    const updated = await store.update(a.id, 'v2', 'tweaked');
    expect(updated?.currentVersion).toBe(2);
    expect(updated?.versions.map(v => v.version)).toEqual([1, 2]);
    expect(await store.getHtml(a.id, 1)).toBe('v1');
    expect(await store.getHtml(a.id, 2)).toBe('v2');
  });

  it('findById hydrates from disk on first access', async () => {
    const { storage, metas, versions } = makeFakeStorage();
    metas.set('preexisting', { id: 'preexisting', title: 'P', slug: 'p', createdAt: 0, updatedAt: 0, threadId: 't', currentVersion: 1, versions: [{ version: 1, createdAt: 0, size: 2 }] });
    versions.set('preexisting:1', 'hi');
    const store = new ArtifactStore(storage);
    expect(store.findById('preexisting')).toBeNull(); // not yet hydrated
    await store.hydrate('preexisting');
    expect(store.findById('preexisting')?.title).toBe('P');
  });
});

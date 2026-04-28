import { makeAutoObservable, runInAction } from 'mobx';
import type { ArtifactStorage } from '../services/artifactStorage';
import {
  makeArtifactId, slugify,
  type ArtifactMeta, type ArtifactVersion,
} from '../core/artifacts';

interface CreateInput {
  title: string;
  html: string;
  threadId: string;
  originMessageId?: string;
}

export class ArtifactStore {
  /** id → meta. Hydrated on demand from disk. */
  private metas = new Map<string, ArtifactMeta>();
  /** `${id}:${version}` → html. Lazy-loaded; not all versions live here. */
  private htmlCache = new Map<string, string>();

  constructor(private readonly storage: ArtifactStorage) {
    makeAutoObservable<this, 'storage'>(this, { storage: false }, { autoBind: true });
  }

  findById(id: string): ArtifactMeta | null {
    return this.metas.get(id) ?? null;
  }

  async hydrate(id: string): Promise<ArtifactMeta | null> {
    const cached = this.metas.get(id);
    if (cached) return cached;
    const meta = await this.storage.readMeta(id);
    if (!meta) return null;
    runInAction(() => { this.metas.set(id, meta); });
    return meta;
  }

  async getHtml(id: string, version: number): Promise<string | null> {
    const key = `${id}:${version}`;
    const cached = this.htmlCache.get(key);
    if (cached != null) return cached;
    const html = await this.storage.readVersion(id, version);
    if (html == null) return null;
    runInAction(() => { this.htmlCache.set(key, html); });
    return html;
  }

  async create(input: CreateInput): Promise<ArtifactMeta> {
    const id = makeArtifactId(input.title);
    const now = Date.now();
    const v: ArtifactVersion = { version: 1, createdAt: now, size: input.html.length };
    const meta: ArtifactMeta = {
      id, title: input.title, slug: slugify(input.title) || 'artifact',
      createdAt: now, updatedAt: now,
      threadId: input.threadId, originMessageId: input.originMessageId,
      currentVersion: 1, versions: [v],
    };
    await this.storage.writeNewVersion(meta, input.html);
    runInAction(() => {
      this.metas.set(id, meta);
      this.htmlCache.set(`${id}:1`, input.html);
    });
    return meta;
  }

  async update(id: string, html: string, changeNote?: string): Promise<ArtifactMeta | null> {
    const existing = await this.hydrate(id);
    if (!existing) return null;
    const nextVersion = existing.currentVersion + 1;
    const now = Date.now();
    const v: ArtifactVersion = { version: nextVersion, createdAt: now, size: html.length, changeNote };
    const next: ArtifactMeta = {
      ...existing,
      updatedAt: now,
      currentVersion: nextVersion,
      versions: [...existing.versions, v],
    };
    await this.storage.writeNewVersion(next, html);
    runInAction(() => {
      this.metas.set(id, next);
      this.htmlCache.set(`${id}:${nextVersion}`, html);
    });
    return next;
  }
}

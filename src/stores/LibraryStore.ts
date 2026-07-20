import { makeAutoObservable, runInAction, toJS } from 'mobx';
import { localRuntimeService } from '../services/local/localRuntimeService';
import {
  librarySourceId,
  loadLibraryDocument,
  normalizeLibraryPath,
  sourceKindForPath,
  workspacePathFromAbsolute,
} from '../services/library/librarySourceService';
import type { LibraryDocument, LibrarySnapshot, LibrarySource } from '../services/library/types';
import { createLibraryPersistence } from '../services/library/libraryStorage';
import type { KeyValuePersistence, PersistenceProvider } from '../services/storage/persistenceProvider';
import type { BridgeStore } from './BridgeStore';

export class LibraryStore {
  sources: LibrarySource[];
  documents = new Map<string, LibraryDocument>();
  lastError: string | null = null;
  refreshing = false;
  private readonly bridge: BridgeStore;
  private readonly persistence: PersistenceProvider<LibrarySnapshot>;
  private readonly pickFile: () => Promise<string | null>;
  private readonly onChanged: () => void;

  constructor(
    bridge: BridgeStore,
    options: { storage?: KeyValuePersistence; pickFile?: () => Promise<string | null>; onChanged?: () => void } = {},
  ) {
    this.bridge = bridge;
    this.persistence = createLibraryPersistence(options.storage);
    this.pickFile = options.pickFile ?? (() => localRuntimeService.pickFile());
    this.onChanged = options.onChanged ?? (() => undefined);
    this.sources = this.persistence.load().sources.map(source => ({ ...source, status: 'idle' }));
    makeAutoObservable<this, 'bridge' | 'persistence' | 'pickFile' | 'onChanged'>(this, {
      bridge: false,
      persistence: false,
      pickFile: false,
      onChanged: false,
    });
  }

  get activeSources(): LibrarySource[] {
    return this.sources.filter(source => source.enabled);
  }

  get readyCount(): number {
    return this.activeSources.filter(source => source.status === 'ready').length;
  }

  get snapshot(): LibrarySnapshot {
    return { sources: this.sources.map(({ id, path, title, kind, enabled, addedAt }) => ({ id, path, title, kind, enabled, addedAt })) };
  }

  async pickAndAdd(): Promise<boolean> {
    this.lastError = null;
    const absolute = await this.pickFile();
    if (!absolute) return false;
    const path = workspacePathFromAbsolute(absolute, this.bridge.workspaceRoot, this.bridge.platform);
    if (!path) {
      runInAction(() => { this.lastError = 'Choose a file inside the current GatesAI workspace.'; });
      return false;
    }
    return this.addPath(path);
  }

  async addPath(value: string): Promise<boolean> {
    try {
      const path = normalizeLibraryPath(value);
      const existing = this.sources.find(source => source.path.toLowerCase() === path.toLowerCase());
      if (existing) {
        this.setEnabled(existing.id, true);
        await this.refreshSource(existing.id);
        return true;
      }
      const kind = sourceKindForPath(path);
      const title = path.split('/').pop() ?? path;
      const source: LibrarySource = {
        id: librarySourceId(path),
        path,
        title,
        kind,
        enabled: true,
        addedAt: Date.now(),
        status: 'idle',
      };
      runInAction(() => {
        this.sources.push(source);
        this.lastError = null;
        this.persist();
      });
      await this.refreshSource(source.id);
      return this.sources.find(item => item.id === source.id)?.status === 'ready';
    } catch (error) {
      runInAction(() => { this.lastError = error instanceof Error ? error.message : String(error); });
      return false;
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const source = this.sources.find(item => item.id === id);
    if (!source || source.enabled === enabled) return;
    source.enabled = enabled;
    if (!enabled) this.documents.delete(id);
    this.persist();
    this.onChanged();
    if (enabled) void this.refreshSource(id);
  }

  async refreshAll(): Promise<void> {
    if (this.refreshing || !this.bridge.isOnline) return;
    this.refreshing = true;
    try {
      for (const source of this.activeSources) await this.refreshSource(source.id);
    } finally {
      runInAction(() => { this.refreshing = false; });
    }
  }

  async refreshSource(id: string): Promise<void> {
    const source = this.sources.find(item => item.id === id);
    if (!source || !source.enabled) return;
    if (!this.bridge.isOnline) {
      runInAction(() => { source.status = 'error'; source.error = 'Bridge is offline.'; });
      return;
    }
    runInAction(() => { source.status = 'loading'; source.error = undefined; });
    try {
      const loaded = await loadLibraryDocument(this.bridge.client, source);
      runInAction(() => {
        this.documents.set(id, loaded.document);
        source.status = 'ready';
        source.updatedAt = loaded.document.updatedAt;
        source.size = loaded.size;
        source.error = undefined;
      });
      this.onChanged();
    } catch (error) {
      runInAction(() => {
        this.documents.delete(id);
        source.status = /not found|no such/i.test(String(error)) ? 'missing' : 'error';
        source.error = error instanceof Error ? error.message : String(error);
      });
      this.onChanged();
    }
  }

  applyImportedSnapshot(snapshot: LibrarySnapshot): void {
    this.sources = snapshot.sources.map(source => ({ ...source, status: 'idle' }));
    this.documents.clear();
    this.persist();
    this.onChanged();
  }

  mergeImportedSnapshot(snapshot: LibrarySnapshot): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    for (const source of snapshot.sources) {
      if (this.sources.some(current => current.path.toLowerCase() === source.path.toLowerCase())) skipped += 1;
      else { this.sources.push({ ...source, status: 'idle' }); imported += 1; }
    }
    this.persist();
    this.onChanged();
    return { imported, skipped };
  }

  private persist(): void {
    this.persistence.save(toJS(this.snapshot));
  }
}

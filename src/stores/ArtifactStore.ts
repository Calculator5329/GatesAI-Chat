// Observable read model for the workspace HTML artifact registry.
// Tool writes remain in services/tools/artifact; this store refreshes the
// versioned sidecar for gallery, palette, and dock surfaces.
import { makeAutoObservable, runInAction } from 'mobx';
import { htmlArtifactPath, type HtmlArtifactRecord } from '../core/htmlArtifacts';
import { loadHtmlArtifactIndex } from '../services/artifacts/artifactRegistry';
import { logger } from '../services/diagnostics/logger';
import type { BridgeClientFacade } from '../services/tools/types';

interface ArtifactStoreBridge {
  readonly isOnline: boolean;
  readonly client: BridgeClientFacade;
}

export class ArtifactStore {
  artifacts: HtmlArtifactRecord[] = [];
  loading = false;
  error: string | null = null;

  private readonly bridge: ArtifactStoreBridge;

  constructor(bridge: ArtifactStoreBridge) {
    this.bridge = bridge;
    makeAutoObservable<this, 'bridge'>(this, { bridge: false });
  }

  findById(id: string): HtmlArtifactRecord | undefined {
    return this.artifacts.find(artifact => artifact.id === id);
  }

  pathFor(id: string): string {
    return htmlArtifactPath(id);
  }

  async refresh(): Promise<void> {
    if (!this.bridge.isOnline) return;
    this.loading = true;
    this.error = null;
    try {
      const index = await loadHtmlArtifactIndex(this.bridge.client);
      runInAction(() => {
        this.artifacts = [...index.artifacts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
    } catch (err) {
      const reason = (err as Error).message || 'Artifact registry refresh failed.';
      logger.warn('html-artifacts', 'registry refresh failed', { err });
      runInAction(() => { this.error = reason; });
    } finally {
      runInAction(() => { this.loading = false; });
    }
  }
}

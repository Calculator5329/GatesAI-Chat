import {
  artifactDataDir, artifactDir, artifactMetaPath, artifactVersionPath,
  type ArtifactMeta,
} from '../core/artifacts';
import type { BridgeFacade } from './tools/types';
import type { FsReadResp } from '../core/workspace';

export class ArtifactStorage {
  private readonly bridge: BridgeFacade;
  constructor(bridge: BridgeFacade) { this.bridge = bridge; }

  async writeNewVersion(meta: ArtifactMeta, html: string): Promise<void> {
    if (!this.bridge.isOnline) throw new Error('bridge offline');
    const c = this.bridge.client;
    await c.request('fs.mkdir', { path: artifactDir(meta.id) });
    await c.request('fs.mkdir', { path: artifactDataDir(meta.id) });
    await c.request('fs.write', {
      path: artifactVersionPath(meta.id, meta.currentVersion),
      content: html, encoding: 'utf8',
    });
    await c.request('fs.write', {
      path: artifactMetaPath(meta.id),
      content: JSON.stringify(meta, null, 2), encoding: 'utf8',
    });
  }

  async readMeta(id: string): Promise<ArtifactMeta | null> {
    if (!this.bridge.isOnline) return null;
    try {
      const resp = await this.bridge.client.request<FsReadResp>('fs.read', { path: artifactMetaPath(id) });
      return JSON.parse(resp.content) as ArtifactMeta;
    } catch {
      return null;
    }
  }

  async readVersion(id: string, version: number): Promise<string | null> {
    if (!this.bridge.isOnline) return null;
    try {
      const resp = await this.bridge.client.request<FsReadResp>('fs.read', { path: artifactVersionPath(id, version) });
      return resp.content;
    } catch {
      return null;
    }
  }
}

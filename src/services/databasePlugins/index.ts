import {
  parseDatabasePluginManifest,
  type DatabasePluginCapability,
  type DatabasePluginDataPolicy,
  type DatabasePluginManifest,
  type DatabasePluginProjection,
} from '../../core/databasePlugins'
import type { GatesRuntimeMode } from '../../core/runtime'

export type DatabasePluginServiceErrorKind = 'desktop_only' | 'unavailable' | 'invalid_manifest'

export type DatabasePluginServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: DatabasePluginServiceErrorKind; message: string } }

export interface DatabasePluginBridge {
  listInstalled(): Promise<unknown[]>
}

export interface DatabasePluginVersionPin {
  id: string
  version: string
  dataPolicy: DatabasePluginDataPolicy
  capabilities: readonly DatabasePluginCapability[]
}

export interface DatabasePluginCitationInput {
  pluginId: string
  pluginVersion: string
  namespace: string
  datasetId: string
  recordId: string
}

export interface DatabasePluginCitation {
  uri: string
  pluginId: string
  pluginVersion: string
  datasetId: string
  recordId: string
}

export interface DatabasePluginService {
  listInstalled(): Promise<DatabasePluginServiceResult<DatabasePluginManifest[]>>
}

export function createDatabasePluginService(options: {
  runtime: GatesRuntimeMode
  bridge?: DatabasePluginBridge
}): DatabasePluginService {
  return {
    async listInstalled() {
      if (options.runtime !== 'desktop') {
        return {
          ok: false,
          error: { kind: 'desktop_only', message: 'Database plugins are available in the desktop app only.' },
        }
      }
      if (!options.bridge) {
        return {
          ok: false,
          error: { kind: 'unavailable', message: 'The desktop database plugin engine is unavailable.' },
        }
      }
      let raw: unknown[]
      try {
        raw = await options.bridge.listInstalled()
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'unavailable',
            message: error instanceof Error ? error.message : 'The desktop database plugin engine is unavailable.',
          },
        }
      }
      try {
        const manifests = raw.map(parseDatabasePluginManifest)
        assertUniqueInstalledVersions(manifests)
        return { ok: true, data: manifests }
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'invalid_manifest',
            message: error instanceof Error ? error.message : 'Installed database plugin metadata is invalid.',
          },
        }
      }
    },
  }
}

export function versionPin(manifest: DatabasePluginManifest): DatabasePluginVersionPin {
  return {
    id: manifest.id,
    version: manifest.version,
    dataPolicy: manifest.data_policy,
    capabilities: [...manifest.capabilities],
  }
}

export function findDatabasePluginProjection(
  manifest: DatabasePluginManifest,
  datasetId: string,
  projectionName: string,
): { datasetId: string; projection: DatabasePluginProjection; kind: 'lookup' | 'search' } | null {
  const dataset = manifest.datasets.find(item => item.id === datasetId)
  if (!dataset) return null
  const lookup = dataset.lookups.find(item => item.name === projectionName)
  if (lookup) return { datasetId, projection: lookup, kind: 'lookup' }
  const search = dataset.searches.find(item => item.name === projectionName)
  return search ? { datasetId, projection: search, kind: 'search' } : null
}

export function projectDatabasePluginCitation(input: DatabasePluginCitationInput): DatabasePluginCitation {
  for (const [name, value] of Object.entries(input)) {
    if (!value || value.length > 256 || value.trim() !== value) {
      throw new Error(`Database plugin citation ${name} must be a non-empty bounded value`)
    }
  }
  const uri = `gatesdb://${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.datasetId)}/${encodeURIComponent(input.recordId)}?plugin=${encodeURIComponent(input.pluginId)}&version=${encodeURIComponent(input.pluginVersion)}`
  return {
    uri,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    datasetId: input.datasetId,
    recordId: input.recordId,
  }
}

function assertUniqueInstalledVersions(manifests: DatabasePluginManifest[]): void {
  const seen = new Set<string>()
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Database plugin ${manifest.id} has multiple active installed versions`)
    }
    seen.add(manifest.id)
  }
}

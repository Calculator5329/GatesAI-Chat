// DatabasePluginManager — local install/list/remove/enable lifecycle for
// downloadable database plugins, plus a bounded query surface with per-plugin
// policy ceilings and stable citations. All persistence and SQLite access go
// through an injected `PluginHost`, so this class is fully testable and never
// touches Tauri directly. No remote registry: install accepts a package the
// user provided from an explicit local file path or URL.
import { DEFAULT_HOST_VERSION } from './constants'
import { err, fromThrown, ok } from './errors'
import { defaultPluginHost, type PluginHost, type PluginHostRow } from './host'
import { verifyPackageIntegrity } from './integrity'
import { validateChecksums, validateManifest } from './manifest'
import {
  assertCapability,
  assertRouteAllowsDataPolicy,
  buildCitation,
  resolveEffectiveDataPolicy,
  resolveQueryLimits,
  tightenDataPolicy,
  type RouteDescriptor,
} from './policy'
import { hostSatisfiesMinimum } from './semver'
import { DATABASE_PLUGIN_BOUNDS, PLUGIN_MEMBER_ID_PATTERN } from './bounds'
import type {
  DatabasePluginDataPolicy,
  DatabasePluginDatasetDescriptor,
  DatabasePluginEvidenceRow,
  DatabasePluginLookupRequest,
  DatabasePluginManifest,
  DatabasePluginPackage,
  DatabasePluginQueryResponse,
  DatabasePluginResult,
  DatabasePluginSearchRequest,
  InstalledDatabasePlugin,
} from './types'

export interface DatabasePluginManagerOptions {
  host?: PluginHost
  /** Host app version used for `minHostVersion` checks. */
  hostVersion?: string
  /** Clock injection for deterministic tests. */
  now?: () => number
}

export interface InstallOptions {
  /**
   * Whether the user explicitly allowed cloud use for a `cloud_allowed` bundle.
   * Ignored for `local_only` bundles. Default: local-only.
   */
  allowCloud?: boolean
  /** Whether to enable immediately after a successful install. Default: false. */
  enable?: boolean
}

export class DatabasePluginManager {
  private readonly host: PluginHost
  private readonly hostVersion: string
  private readonly now: () => number

  constructor(options: DatabasePluginManagerOptions = {}) {
    this.host = options.host ?? defaultPluginHost()
    this.hostVersion = options.hostVersion ?? DEFAULT_HOST_VERSION
    this.now = options.now ?? (() => Date.now())
  }

  get available(): boolean {
    return this.host.available
  }

  /** List installed plugins. Web Lite returns an empty list (nothing installed). */
  async list(): Promise<DatabasePluginResult<InstalledDatabasePlugin[]>> {
    if (!this.host.available) return ok([])
    try {
      return ok(await this.host.list())
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  async get(id: string): Promise<DatabasePluginResult<InstalledDatabasePlugin>> {
    const listed = await this.list()
    if (!listed.ok) return listed
    const found = listed.data.find(p => p.id === id)
    return found ? ok(found) : err('not_found', `No installed plugin with id "${id}".`)
  }

  /**
   * Install a package the user provided (local file or explicit URL). Validates
   * the manifest and checksums, verifies integrity and bounds, checks host
   * compatibility, then promotes it through the host. Fails closed on any
   * violation; nothing is written unless every check passes.
   */
  async install(pkg: DatabasePluginPackage, options: InstallOptions = {}): Promise<DatabasePluginResult<InstalledDatabasePlugin>> {
    if (!this.host.available) {
      return err('web_lite', 'Database plugins can be installed only in the GatesAI desktop app.')
    }
    let manifest: DatabasePluginManifest
    try {
      // Re-validate from the raw manifest/checksums so a hand-built package
      // object cannot smuggle past the parser.
      manifest = validateManifest(pkg.manifest)
      const checksums = validateChecksums(pkg.checksums)
      verifyPackageIntegrity(manifest, checksums, pkg.files)
    } catch (error) {
      return fromThrown(error, 'invalid_manifest')
    }

    if (!hostSatisfiesMinimum(this.hostVersion, manifest.minHostVersion)) {
      return err('incompatible_host', `Plugin "${manifest.id}" requires host version ${manifest.minHostVersion} or newer; this host is ${this.hostVersion}.`)
    }

    const requestedPolicy: DatabasePluginDataPolicy = resolveEffectiveDataPolicy(manifest, options.allowCloud)
    const tightened = tightenDataPolicy(manifest, requestedPolicy)
    if (!tightened.ok) return { ok: false, error: tightened.error }

    const record: InstalledDatabasePlugin = {
      id: manifest.id,
      version: manifest.version,
      manifest,
      enabled: options.enable === true,
      installedAt: this.now(),
      source: pkg.source,
      effectiveDataPolicy: tightened.policy,
    }
    try {
      await this.host.install(record, pkg.files)
      return ok(record)
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  async remove(id: string): Promise<DatabasePluginResult<true>> {
    if (!this.host.available) return err('web_lite', 'Database plugins can be managed only in the GatesAI desktop app.')
    try {
      await this.host.remove(id)
      return ok(true)
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<DatabasePluginResult<true>> {
    if (!this.host.available) return err('web_lite', 'Database plugins can be managed only in the GatesAI desktop app.')
    try {
      await this.host.setEnabled(id, enabled)
      return ok(true)
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  /**
   * Bounded text search over a manifest-declared dataset/projection. Enforces
   * enablement, the `search.read` capability, the local-only/cloud-route gate,
   * and the resolved result/transcript ceilings. Returns capped evidence rows
   * with stable `gatesdb://` citations.
   */
  async search(request: DatabasePluginSearchRequest, route: RouteDescriptor): Promise<DatabasePluginResult<DatabasePluginQueryResponse>> {
    const resolved = await this.resolveDatasetForQuery(request.pluginId, request.datasetId, 'search.read', route)
    if (!resolved.ok) return resolved
    const { plugin, dataset } = resolved.data

    const query = typeof request.query === 'string' ? request.query.trim() : ''
    if (!query || query.length > DATABASE_PLUGIN_BOUNDS.maxQueryLength) {
      return err('invalid_request', `Search query must be 1 to ${DATABASE_PLUGIN_BOUNDS.maxQueryLength} characters.`)
    }
    const projection = request.searchId
      ? dataset.searches?.find(s => s.id === request.searchId)
      : dataset.searches?.[0]
    if (request.searchId && !projection) {
      return err('invalid_request', `Dataset "${dataset.id}" declares no search projection "${request.searchId}".`)
    }
    const limits = resolveQueryLimits(dataset, request.limit, projection)

    try {
      const rows = await this.host.search({
        pluginId: plugin.id,
        version: plugin.version,
        datasetPath: dataset.path,
        searchId: projection?.id,
        query,
        limit: limits.maxResults,
      })
      return ok(this.projectRows(plugin, dataset, rows, limits.maxResults, limits.maxTranscriptChars))
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  /**
   * Named lookup with typed scalar parameters. No SQL text ever crosses this
   * boundary — only a declared projection id and bounded parameters.
   */
  async lookup(request: DatabasePluginLookupRequest, route: RouteDescriptor): Promise<DatabasePluginResult<DatabasePluginQueryResponse>> {
    const resolved = await this.resolveDatasetForQuery(request.pluginId, request.datasetId, 'lookup.read', route)
    if (!resolved.ok) return resolved
    const { plugin, dataset } = resolved.data

    if (!PLUGIN_MEMBER_ID_PATTERN.test(request.lookupId)) {
      return err('invalid_request', 'lookupId is not a valid identifier.')
    }
    const projection = dataset.lookups?.find(l => l.id === request.lookupId)
    if (!projection) {
      return err('invalid_request', `Dataset "${dataset.id}" declares no lookup "${request.lookupId}".`)
    }

    const parameters: Record<string, string | number | boolean> = {}
    for (const spec of projection.parameters) {
      const value = request.parameters[spec.name]
      if (value === undefined) {
        if (spec.required) return err('invalid_request', `Lookup "${projection.id}" requires parameter "${spec.name}".`)
        continue
      }
      if (typeof value !== spec.type) {
        return err('invalid_request', `Lookup "${projection.id}" parameter "${spec.name}" must be a ${spec.type}.`)
      }
      if (spec.type === 'string') {
        const max = spec.maxLength ?? DATABASE_PLUGIN_BOUNDS.maxParameterLength
        if ((value as string).length > max) {
          return err('invalid_request', `Lookup "${projection.id}" parameter "${spec.name}" exceeds ${max} characters.`)
        }
      }
      parameters[spec.name] = value
    }
    // Reject unknown parameters — the projection declares the full surface.
    for (const key of Object.keys(request.parameters)) {
      if (!projection.parameters.some(p => p.name === key)) {
        return err('invalid_request', `Lookup "${projection.id}" does not accept parameter "${key}".`)
      }
    }

    const limits = resolveQueryLimits(dataset)
    try {
      const rows = await this.host.lookup({
        pluginId: plugin.id,
        version: plugin.version,
        datasetPath: dataset.path,
        lookupId: projection.id,
        parameters,
        limit: limits.maxResults,
      })
      return ok(this.projectRows(plugin, dataset, rows, limits.maxResults, limits.maxTranscriptChars))
    } catch (error) {
      return fromThrown(error, 'host_error')
    }
  }

  private async resolveDatasetForQuery(
    pluginId: string,
    datasetId: string,
    capability: 'search.read' | 'lookup.read',
    route: RouteDescriptor,
  ): Promise<DatabasePluginResult<{ plugin: InstalledDatabasePlugin; dataset: DatabasePluginDatasetDescriptor }>> {
    if (!this.host.available) return err('web_lite', 'Database plugin queries run only in the GatesAI desktop app.')
    const found = await this.get(pluginId)
    if (!found.ok) return found
    const plugin = found.data

    const capabilityError = assertCapability(plugin, capability)
    if (capabilityError) return { ok: false, error: capabilityError }

    const routeError = assertRouteAllowsDataPolicy(plugin.effectiveDataPolicy, route)
    if (routeError) return { ok: false, error: routeError }

    const dataset = plugin.manifest.datasets.find(d => d.id === datasetId)
    if (!dataset) return err('invalid_request', `Plugin "${pluginId}" has no dataset "${datasetId}".`)
    return ok({ plugin, dataset })
  }

  /** Cap, cite, and bound host rows before they can enter a transcript. */
  private projectRows(
    plugin: InstalledDatabasePlugin,
    dataset: DatabasePluginDatasetDescriptor,
    rows: PluginHostRow[],
    maxResults: number,
    maxTranscriptChars: number,
  ): DatabasePluginQueryResponse {
    const capped = rows.slice(0, maxResults)
    const evidence: DatabasePluginEvidenceRow[] = []
    let transcriptChars = 0
    let truncated = rows.length > maxResults
    for (const row of capped) {
      const citation = buildCitation(plugin.id, plugin.version, dataset.id, row.recordId)
      const projected: DatabasePluginEvidenceRow = { recordId: row.recordId, citation, fields: row.fields }
      const size = JSON.stringify(projected).length
      if (transcriptChars + size > maxTranscriptChars) {
        truncated = true
        break
      }
      transcriptChars += size
      evidence.push(projected)
    }
    return {
      pluginId: plugin.id,
      version: plugin.version,
      datasetId: dataset.id,
      truncated,
      rows: evidence,
    }
  }
}

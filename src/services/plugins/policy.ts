// Per-plugin policy ceilings. Resolves the effective data policy (a manifest is
// only a ceiling — default local-only, user may tighten, never loosen), gates a
// cloud route against `local_only` data, checks declared capabilities, and
// resolves the bounded result/transcript limits a query runs under. Pure.
import { DATABASE_PLUGIN_BOUNDS } from './bounds'
import { fail } from './errors'
import type {
  DatabasePluginCapability,
  DatabasePluginDataPolicy,
  DatabasePluginDatasetDescriptor,
  DatabasePluginError,
  DatabasePluginManifest,
  DatabasePluginQueryLimits,
  DatabasePluginSearchDescriptor,
  InstalledDatabasePlugin,
} from './types'

/** The resolved model route a query would run under. */
export interface RouteDescriptor {
  /** True when the effective model runs locally (Ollama, etc.). */
  isLocal: boolean
  /** Display id for messages. */
  modelId?: string
}

/**
 * Resolve the effective data policy from the manifest ceiling and an optional
 * user preference. `local_only` manifests can never be loosened; `cloud_allowed`
 * manifests default to `local_only` unless the user has explicitly allowed cloud.
 */
export function resolveEffectiveDataPolicy(
  manifest: DatabasePluginManifest,
  userAllowsCloud?: boolean,
): DatabasePluginDataPolicy {
  if (manifest.dataPolicy === 'local_only') return 'local_only'
  return userAllowsCloud === true ? 'cloud_allowed' : 'local_only'
}

/**
 * A requested policy is valid only if it does not exceed the manifest ceiling.
 * Returns the accepted policy or an error if the user tried to loosen it.
 */
export function tightenDataPolicy(
  manifest: DatabasePluginManifest,
  requested: DatabasePluginDataPolicy,
): { ok: true; policy: DatabasePluginDataPolicy } | { ok: false; error: DatabasePluginError } {
  if (requested === 'cloud_allowed' && manifest.dataPolicy === 'local_only') {
    return { ok: false, error: fail('data_policy_blocked', `Plugin "${manifest.id}" is local_only; cloud use cannot be enabled.`) }
  }
  return { ok: true, policy: requested }
}

/**
 * Fail closed when `local_only` data would flow to a cloud route. Runs before
 * any model context is assembled. `cloud_allowed` data may only enter the exact
 * pinned cloud route.
 */
export function assertRouteAllowsDataPolicy(
  policy: DatabasePluginDataPolicy,
  route: RouteDescriptor,
): DatabasePluginError | null {
  if (policy === 'local_only' && !route.isLocal) {
    return fail('data_policy_blocked', 'This plugin is local-only and cannot be used with a cloud model. Switch to a local model or disable the plugin for this run.')
  }
  return null
}

/** Whether a plugin is enabled and declares the given capability. */
export function assertCapability(
  plugin: InstalledDatabasePlugin,
  capability: DatabasePluginCapability,
): DatabasePluginError | null {
  if (!plugin.enabled) {
    return fail('disabled', `Plugin "${plugin.id}" is installed but disabled.`)
  }
  if (!plugin.manifest.capabilities.includes(capability)) {
    return fail('capability_denied', `Plugin "${plugin.id}" does not declare the "${capability}" capability.`)
  }
  return null
}

/**
 * Resolve the bounded result/transcript limits for a query, taking the
 * strictest of: host default, dataset ceiling, projection ceiling, and the
 * requested limit. The result never exceeds the host maximum.
 */
export function resolveQueryLimits(
  dataset: DatabasePluginDatasetDescriptor,
  requestedLimit?: number,
  projection?: DatabasePluginSearchDescriptor,
): DatabasePluginQueryLimits {
  const candidates = [DATABASE_PLUGIN_BOUNDS.maxResults]
  if (typeof dataset.maxResults === 'number') candidates.push(dataset.maxResults)
  if (projection && typeof projection.maxResults === 'number') candidates.push(projection.maxResults)
  if (typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0) {
    candidates.push(Math.floor(requestedLimit))
  }
  return {
    maxResults: Math.max(1, Math.min(...candidates)),
    maxTranscriptChars: DATABASE_PLUGIN_BOUNDS.maxTranscriptChars,
  }
}

/** Build the stable, opaque citation URI for one evidence record. */
export function buildCitation(
  pluginId: string,
  version: string,
  datasetId: string,
  recordId: string,
): string {
  return `gatesdb://${pluginId}@${version}/${datasetId}/${encodeURIComponent(recordId)}`
}

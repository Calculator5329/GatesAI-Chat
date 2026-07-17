// Public surface for the downloadable database plugin foundation (Story AP-1).
// The wiring lane consumes these; this slice never edits the shared registry,
// root store, or ToolContext.
export * from './types'
export { DATABASE_PLUGIN_BOUNDS } from './bounds'
export { DatabasePluginValidationError } from './errors'
export {
  parseManifest,
  validateManifest,
  validateChecksums,
  isSafePayloadPath,
  hasExecutableExtension,
} from './manifest'
export {
  verifyPackageIntegrity,
  computeChecksumsDigest,
  canonicalizeChecksums,
} from './integrity'
export { sha256Hex, sha256HexUtf8 } from './sha256'
export {
  resolveEffectiveDataPolicy,
  tightenDataPolicy,
  assertRouteAllowsDataPolicy,
  assertCapability,
  resolveQueryLimits,
  buildCitation,
  type RouteDescriptor,
} from './policy'
export {
  DatabasePluginManager,
  type DatabasePluginManagerOptions,
  type InstallOptions,
} from './manager'
export {
  type PluginHost,
  type PluginHostRow,
  type PluginHostSearchInput,
  type PluginHostLookupInput,
  tauriPluginHost,
  unavailablePluginHost,
  defaultPluginHost,
} from './host'
export {
  createDatabasePluginTools,
  type DatabasePluginToolFacade,
} from './tool'

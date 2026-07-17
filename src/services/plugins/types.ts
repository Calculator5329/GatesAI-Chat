// Domain contracts for downloadable database plugins (Story AP-1, package
// schema 1). Pure data + type-only definitions so every layer can read the
// shapes without crossing UI -> store -> service -> core boundaries. No side
// effects, no Tauri, no store state here.
//
// A database plugin is a data-only archive (working name `.gatesdb`). V1
// bundles carry no scripts, native code, HTML, migrations, triggers, arbitrary
// query templates, secrets, or network endpoints. The runtime only ever runs
// host-defined query builders over manifest-declared datasets.

/** Package manifest schema version this module understands. */
export const DATABASE_PLUGIN_SCHEMA_VERSION = 1

/** Directory (under app-data) that owns installed plugin versions. */
export const DATABASE_PLUGINS_DIRNAME = 'database-plugins'

/**
 * Capabilities a plugin may declare. Read-only enum — a plugin can never grant
 * code execution, network, filesystem, or arbitrary-SQL authority.
 */
export const DATABASE_PLUGIN_CAPABILITIES = [
  'catalog.read',
  'schema.read',
  'lookup.read',
  'search.read',
] as const
export type DatabasePluginCapability = (typeof DATABASE_PLUGIN_CAPABILITIES)[number]

/**
 * Where bundle content may travel. The manifest is a ceiling: the default is
 * always local-only and a user may tighten but never loosen it beyond the
 * author's declaration.
 */
export type DatabasePluginDataPolicy = 'local_only' | 'cloud_allowed'

/** Supported payload digest algorithm. */
export type DatabasePluginDigestAlgorithm = 'sha-256'

/** A single named dataset (SQLite file) inside the bundle. */
export interface DatabasePluginDatasetDescriptor {
  /** Stable dataset id, referenced by citations and tool calls. */
  id: string
  /** Human label shown in inspect UI. */
  title: string
  /** One-line description of what the dataset holds. */
  description: string
  /** Payload path, relative to the archive root (e.g. `data/people.sqlite`). */
  path: string
  /** Approximate row count for honest inspect display; not a query bound. */
  approxRecords?: number
  /** Named lookup projections callable via `database_plugins.lookup`. */
  lookups?: DatabasePluginLookupDescriptor[]
  /** Named full-text search projections callable via `database_plugins.search`. */
  searches?: DatabasePluginSearchDescriptor[]
  /** Optional per-dataset stricter result ceiling (never exceeds host default). */
  maxResults?: number
}

/** A bounded scalar parameter accepted by a lookup/search projection. */
export interface DatabasePluginParameter {
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  /** Max length for string parameters (defensive bound). */
  maxLength?: number
}

export interface DatabasePluginLookupDescriptor {
  id: string
  description: string
  parameters: DatabasePluginParameter[]
}

export interface DatabasePluginSearchDescriptor {
  id: string
  description: string
  /** Max matches this projection returns (never exceeds host/dataset ceiling). */
  maxResults?: number
}

/** Provenance/publisher material. Checksums prove payload integrity, not identity. */
export interface DatabasePluginPublisher {
  name: string
  /** Optional homepage / provenance URL. Metadata only. */
  url?: string
}

/**
 * Optional publisher signature. Displayed with its key fingerprint but only
 * called "trusted" after the user explicitly trusts that key/catalog.
 * Mandatory trust roots and revocation are later scope.
 */
export interface DatabasePluginSignature {
  algorithm: string
  keyFingerprint: string
  value: string
}

/** Digest binding the manifest to its payload checksum document. */
export interface DatabasePluginIntegrity {
  algorithm: DatabasePluginDigestAlgorithm
  /** Lowercase hex digest of the canonical checksums document. */
  digest: string
}

/** Canonical `plugin.json`, schema 1. */
export interface DatabasePluginManifest {
  schemaVersion: number
  /** Immutable plugin id, reverse-DNS style, e.g. `com.example.people`. */
  id: string
  /** Semantic version string. */
  version: string
  description: string
  publisher: DatabasePluginPublisher
  /** Minimum host app version required. */
  minHostVersion?: string
  /** Compressed archive size in bytes (honest inspect display). */
  compressedBytes?: number
  /** Expanded on-disk size in bytes. */
  expandedBytes?: number
  /** Citation namespace, e.g. `people` -> `gatesdb://<id>@<version>/...`. */
  citationNamespace: string
  /** SPDX-ish license identifier for the packaged content. */
  contentLicense: string
  /** Update URL / catalog identity (metadata only; never auto-fetched). */
  updateUrl?: string
  dataPolicy: DatabasePluginDataPolicy
  capabilities: DatabasePluginCapability[]
  datasets: DatabasePluginDatasetDescriptor[]
  integrity: DatabasePluginIntegrity
  signature?: DatabasePluginSignature
}

/** Per-file digest document (`checksums.json`). Maps payload path -> hex digest. */
export interface DatabasePluginChecksums {
  algorithm: DatabasePluginDigestAlgorithm
  files: Record<string, string>
}

/** A payload file presented to the installer for verification. */
export interface DatabasePluginPayloadFile {
  path: string
  bytes: Uint8Array
}

/** An installer input: manifest + checksum doc + payload bytes. */
export interface DatabasePluginPackage {
  manifest: DatabasePluginManifest
  checksums: DatabasePluginChecksums
  files: DatabasePluginPayloadFile[]
  /** Where this package came from — a local path or an explicit HTTPS URL. */
  source: DatabasePluginSource
}

export interface DatabasePluginSource {
  kind: 'file' | 'url'
  location: string
}

/** Lifecycle state of an installed plugin, owned later by DatabasePluginStore. */
export type DatabasePluginState = 'installed' | 'enabled' | 'disabled' | 'incompatible'

/** A record of one installed plugin version in the app-data directory. */
export interface InstalledDatabasePlugin {
  id: string
  version: string
  manifest: DatabasePluginManifest
  enabled: boolean
  installedAt: number
  source: DatabasePluginSource
  /**
   * Effective data policy after the user's tightening. Never looser than
   * `manifest.dataPolicy`.
   */
  effectiveDataPolicy: DatabasePluginDataPolicy
}

/** Typed error kinds. Each is a distinct fail-closed state; none means "retry elsewhere". */
export type DatabasePluginErrorKind =
  | 'web_lite'
  | 'invalid_manifest'
  | 'unsupported_schema'
  | 'incompatible_host'
  | 'integrity_mismatch'
  | 'checksum_missing'
  | 'unsafe_path'
  | 'too_large'
  | 'too_many_files'
  | 'executable_payload'
  | 'duplicate_path'
  | 'not_found'
  | 'disabled'
  | 'capability_denied'
  | 'data_policy_blocked'
  | 'invalid_request'
  | 'host_error'
  | 'unknown'

export interface DatabasePluginError {
  kind: DatabasePluginErrorKind
  message: string
}

export type DatabasePluginResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DatabasePluginError }

// ---- Query surface ---------------------------------------------------------

export interface DatabasePluginSearchRequest {
  pluginId: string
  datasetId: string
  /** Named search projection declared by the dataset. */
  searchId?: string
  query: string
  limit?: number
}

export interface DatabasePluginLookupRequest {
  pluginId: string
  datasetId: string
  /** Named lookup projection declared by the dataset. */
  lookupId: string
  /** Typed scalar parameters; no SQL text ever crosses this boundary. */
  parameters: Record<string, string | number | boolean>
}

/** One evidence row. `citation` is the opaque, stable `gatesdb://` URI. */
export interface DatabasePluginEvidenceRow {
  recordId: string
  citation: string
  fields: Record<string, string | number | boolean | null>
}

export interface DatabasePluginQueryResponse {
  pluginId: string
  version: string
  datasetId: string
  /** True when results were capped by policy before returning. */
  truncated: boolean
  rows: DatabasePluginEvidenceRow[]
}

/** The bounds a query is executed under, resolved from host + manifest ceilings. */
export interface DatabasePluginQueryLimits {
  maxResults: number
  maxTranscriptChars: number
}

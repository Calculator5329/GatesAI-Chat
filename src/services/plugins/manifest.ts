// Canonical `plugin.json` parser/validator for database plugin packages,
// schema 1. Pure and total: hostile input produces a typed error, never a
// throw that escapes `parseManifest`. Enforces the enum-only capability set,
// payload-path safety, digest shape, and declared bounds. No Tauri, no I/O.
import {
  DATABASE_PLUGIN_BOUNDS,
  PLUGIN_ID_PATTERN,
  PLUGIN_MEMBER_ID_PATTERN,
  PLUGIN_NAMESPACE_PATTERN,
  PLUGIN_VERSION_PATTERN,
  SHA256_HEX_PATTERN,
} from './bounds'
import { DatabasePluginValidationError, err, ok } from './errors'
import {
  DATABASE_PLUGIN_CAPABILITIES,
  DATABASE_PLUGIN_SCHEMA_VERSION,
  type DatabasePluginCapability,
  type DatabasePluginChecksums,
  type DatabasePluginDatasetDescriptor,
  type DatabasePluginDataPolicy,
  type DatabasePluginLookupDescriptor,
  type DatabasePluginManifest,
  type DatabasePluginParameter,
  type DatabasePluginResult,
  type DatabasePluginSearchDescriptor,
} from './types'

function bad(kind: DatabasePluginValidationError['kind'], message: string): never {
  throw new DatabasePluginValidationError(kind, message)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bad('invalid_manifest', `${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function str(record: Record<string, unknown>, key: string, label: string, max: number = DATABASE_PLUGIN_BOUNDS.maxIdentifierLength): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) bad('invalid_manifest', `${label}.${key} must be a non-empty string.`)
  if ((value as string).length > max) bad('invalid_manifest', `${label}.${key} exceeds ${max} characters.`)
  return value as string
}

function optStr(record: Record<string, unknown>, key: string, label: string, max: number): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') bad('invalid_manifest', `${label}.${key} must be a string when present.`)
  if ((value as string).length > max) bad('invalid_manifest', `${label}.${key} exceeds ${max} characters.`)
  return value as string
}

function optPosInt(record: Record<string, unknown>, key: string, label: string, max: number): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) bad('invalid_manifest', `${label}.${key} must be a non-negative integer.`)
  if ((value as number) > max) bad('too_large', `${label}.${key} exceeds the allowed maximum (${max}).`)
  return value as number
}

/**
 * A payload path is safe only when it is relative, forward-slashed, free of
 * `.`/`..` segments, absolute roots, drive letters, backslashes, NUL, and
 * leading/trailing slashes. Executable-looking payloads are rejected too — V1
 * bundles are data only.
 */
export function isSafePayloadPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > DATABASE_PLUGIN_BOUNDS.maxPathLength) return false
  if (path.includes('\\') || path.includes('\0')) return false
  if (path.startsWith('/') || path.endsWith('/')) return false
  if (/^[a-zA-Z]:/.test(path)) return false // drive letter
  const segments = path.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return false
  }
  return !hasExecutableExtension(path)
}

const EXECUTABLE_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.js', '.mjs', '.cjs', '.ts', '.sh', '.bat', '.cmd',
  '.ps1', '.py', '.rb', '.php', '.wasm', '.html', '.htm', '.svg', '.bin', '.app', '.scr',
]

export function hasExecutableExtension(path: string): boolean {
  const lower = path.toLowerCase()
  return EXECUTABLE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function parseParameters(value: unknown, label: string): DatabasePluginParameter[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) bad('invalid_manifest', `${label} must be an array.`)
  return (value as unknown[]).map((raw, i) => {
    const record = asRecord(raw, `${label}[${i}]`)
    const name = str(record, 'name', `${label}[${i}]`)
    if (!PLUGIN_MEMBER_ID_PATTERN.test(name)) bad('invalid_manifest', `${label}[${i}].name is not a valid identifier.`)
    const type = record.type
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      bad('invalid_manifest', `${label}[${i}].type must be string|number|boolean.`)
    }
    const parameter: DatabasePluginParameter = { name, type: type as 'string' | 'number' | 'boolean' }
    if (record.required !== undefined) {
      if (typeof record.required !== 'boolean') bad('invalid_manifest', `${label}[${i}].required must be boolean.`)
      parameter.required = record.required
    }
    const maxLength = optPosInt(record, 'maxLength', `${label}[${i}]`, DATABASE_PLUGIN_BOUNDS.maxParameterLength)
    if (maxLength !== undefined) parameter.maxLength = maxLength
    return parameter
  })
}

function parseLookups(value: unknown, label: string): DatabasePluginLookupDescriptor[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) bad('invalid_manifest', `${label} must be an array.`)
  return (value as unknown[]).map((raw, i) => {
    const record = asRecord(raw, `${label}[${i}]`)
    const id = str(record, 'id', `${label}[${i}]`)
    if (!PLUGIN_MEMBER_ID_PATTERN.test(id)) bad('invalid_manifest', `${label}[${i}].id is not a valid identifier.`)
    return {
      id,
      description: str(record, 'description', `${label}[${i}]`, 500),
      parameters: parseParameters(record.parameters, `${label}[${i}].parameters`),
    }
  })
}

function parseSearches(value: unknown, label: string): DatabasePluginSearchDescriptor[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) bad('invalid_manifest', `${label} must be an array.`)
  return (value as unknown[]).map((raw, i) => {
    const record = asRecord(raw, `${label}[${i}]`)
    const id = str(record, 'id', `${label}[${i}]`)
    if (!PLUGIN_MEMBER_ID_PATTERN.test(id)) bad('invalid_manifest', `${label}[${i}].id is not a valid identifier.`)
    const descriptor: DatabasePluginSearchDescriptor = {
      id,
      description: str(record, 'description', `${label}[${i}]`, 500),
    }
    const maxResults = optPosInt(record, 'maxResults', `${label}[${i}]`, DATABASE_PLUGIN_BOUNDS.maxResults)
    if (maxResults !== undefined) descriptor.maxResults = maxResults
    return descriptor
  })
}

function parseDatasets(value: unknown): DatabasePluginDatasetDescriptor[] {
  if (!Array.isArray(value) || value.length === 0) bad('invalid_manifest', 'datasets must be a non-empty array.')
  if ((value as unknown[]).length > DATABASE_PLUGIN_BOUNDS.maxFiles) bad('too_many_files', 'datasets exceeds the file limit.')
  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()
  return (value as unknown[]).map((raw, i) => {
    const record = asRecord(raw, `datasets[${i}]`)
    const id = str(record, 'id', `datasets[${i}]`)
    if (!PLUGIN_MEMBER_ID_PATTERN.test(id)) bad('invalid_manifest', `datasets[${i}].id is not a valid identifier.`)
    if (seenIds.has(id)) bad('invalid_manifest', `datasets[${i}].id "${id}" is duplicated.`)
    seenIds.add(id)
    const path = str(record, 'path', `datasets[${i}]`, DATABASE_PLUGIN_BOUNDS.maxPathLength)
    if (!isSafePayloadPath(path)) bad('unsafe_path', `datasets[${i}].path "${path}" is not a safe relative payload path.`)
    if (seenPaths.has(path)) bad('duplicate_path', `datasets[${i}].path "${path}" is duplicated.`)
    seenPaths.add(path)
    const descriptor: DatabasePluginDatasetDescriptor = {
      id,
      title: str(record, 'title', `datasets[${i}]`, 300),
      description: str(record, 'description', `datasets[${i}]`, 1_000),
      path,
      lookups: parseLookups(record.lookups, `datasets[${i}].lookups`),
      searches: parseSearches(record.searches, `datasets[${i}].searches`),
    }
    const approxRecords = optPosInt(record, 'approxRecords', `datasets[${i}]`, Number.MAX_SAFE_INTEGER)
    if (approxRecords !== undefined) descriptor.approxRecords = approxRecords
    const maxResults = optPosInt(record, 'maxResults', `datasets[${i}]`, DATABASE_PLUGIN_BOUNDS.maxResults)
    if (maxResults !== undefined) descriptor.maxResults = maxResults
    return descriptor
  })
}

function parseCapabilities(value: unknown): DatabasePluginCapability[] {
  if (!Array.isArray(value) || value.length === 0) bad('invalid_manifest', 'capabilities must be a non-empty array.')
  const seen = new Set<DatabasePluginCapability>()
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'string' || !DATABASE_PLUGIN_CAPABILITIES.includes(raw as DatabasePluginCapability)) {
      bad('invalid_manifest', `capabilities contains unknown capability "${String(raw)}".`)
    }
    seen.add(raw as DatabasePluginCapability)
  }
  return [...seen]
}

function parseDataPolicy(value: unknown): DatabasePluginDataPolicy {
  if (value === 'local_only' || value === 'cloud_allowed') return value
  bad('invalid_manifest', 'dataPolicy must be "local_only" or "cloud_allowed".')
}

/** Validate a parsed value as a schema-1 manifest, throwing a typed error. */
export function validateManifest(value: unknown): DatabasePluginManifest {
  const record = asRecord(value, 'manifest')
  const schemaVersion = record.schemaVersion
  if (schemaVersion !== DATABASE_PLUGIN_SCHEMA_VERSION) {
    bad('unsupported_schema', `Unsupported schemaVersion ${String(schemaVersion)}; this host understands ${DATABASE_PLUGIN_SCHEMA_VERSION}.`)
  }

  const id = str(record, 'id', 'manifest')
  if (!PLUGIN_ID_PATTERN.test(id)) bad('invalid_manifest', `manifest.id "${id}" is not a valid reverse-DNS id.`)
  const version = str(record, 'version', 'manifest')
  if (!PLUGIN_VERSION_PATTERN.test(version)) bad('invalid_manifest', `manifest.version "${version}" is not a valid semantic version.`)

  const publisherRecord = asRecord(record.publisher, 'manifest.publisher')
  const publisher = {
    name: str(publisherRecord, 'name', 'manifest.publisher', 200),
    url: optStr(publisherRecord, 'url', 'manifest.publisher', 2_000),
  }

  const citationNamespace = str(record, 'citationNamespace', 'manifest')
  if (!PLUGIN_NAMESPACE_PATTERN.test(citationNamespace)) bad('invalid_manifest', 'manifest.citationNamespace is not a valid namespace token.')

  const integrityRecord = asRecord(record.integrity, 'manifest.integrity')
  if (integrityRecord.algorithm !== 'sha-256') bad('invalid_manifest', 'manifest.integrity.algorithm must be "sha-256".')
  const digest = str(integrityRecord, 'digest', 'manifest.integrity', 64)
  if (!SHA256_HEX_PATTERN.test(digest)) bad('invalid_manifest', 'manifest.integrity.digest must be a lowercase hex sha-256 digest.')

  const manifest: DatabasePluginManifest = {
    schemaVersion: DATABASE_PLUGIN_SCHEMA_VERSION,
    id,
    version,
    description: str(record, 'description', 'manifest', 2_000),
    publisher,
    citationNamespace,
    contentLicense: str(record, 'contentLicense', 'manifest', 200),
    dataPolicy: parseDataPolicy(record.dataPolicy),
    capabilities: parseCapabilities(record.capabilities),
    datasets: parseDatasets(record.datasets),
    integrity: { algorithm: 'sha-256', digest },
  }

  const minHostVersion = optStr(record, 'minHostVersion', 'manifest', 64)
  if (minHostVersion !== undefined) manifest.minHostVersion = minHostVersion
  const updateUrl = optStr(record, 'updateUrl', 'manifest', 2_000)
  if (updateUrl !== undefined) manifest.updateUrl = updateUrl
  const compressedBytes = optPosInt(record, 'compressedBytes', 'manifest', DATABASE_PLUGIN_BOUNDS.maxCompressedBytes)
  if (compressedBytes !== undefined) manifest.compressedBytes = compressedBytes
  const expandedBytes = optPosInt(record, 'expandedBytes', 'manifest', DATABASE_PLUGIN_BOUNDS.maxExpandedBytes)
  if (expandedBytes !== undefined) manifest.expandedBytes = expandedBytes

  if (record.signature !== undefined) {
    const sig = asRecord(record.signature, 'manifest.signature')
    manifest.signature = {
      algorithm: str(sig, 'algorithm', 'manifest.signature', 64),
      keyFingerprint: str(sig, 'keyFingerprint', 'manifest.signature', 200),
      value: str(sig, 'value', 'manifest.signature', 4_000),
    }
  }

  // Every capability the manifest declares must be backed by data: a lookup
  // capability with no dataset lookups, or a search capability with no dataset
  // searches, is dishonest and rejected.
  assertCapabilityBacking(manifest)
  return manifest
}

function assertCapabilityBacking(manifest: DatabasePluginManifest): void {
  const hasLookup = manifest.datasets.some(d => (d.lookups?.length ?? 0) > 0)
  const hasSearch = manifest.datasets.some(d => (d.searches?.length ?? 0) > 0)
  if (manifest.capabilities.includes('lookup.read') && !hasLookup) {
    bad('invalid_manifest', 'lookup.read declared but no dataset declares a lookup projection.')
  }
  if (manifest.capabilities.includes('search.read') && !hasSearch) {
    bad('invalid_manifest', 'search.read declared but no dataset declares a search projection.')
  }
}

/** Total wrapper: never throws, returns a typed result. */
export function parseManifest(value: unknown): DatabasePluginResult<DatabasePluginManifest> {
  try {
    return ok(validateManifest(value))
  } catch (error) {
    if (error instanceof DatabasePluginValidationError) return err(error.kind, error.message)
    return err('invalid_manifest', error instanceof Error ? error.message : String(error))
  }
}

/** Validate a checksums document (`checksums.json`). */
export function validateChecksums(value: unknown): DatabasePluginChecksums {
  const record = asRecord(value, 'checksums')
  if (record.algorithm !== 'sha-256') bad('invalid_manifest', 'checksums.algorithm must be "sha-256".')
  const files = asRecord(record.files, 'checksums.files')
  const entries: Record<string, string> = {}
  const keys = Object.keys(files)
  if (keys.length === 0) bad('invalid_manifest', 'checksums.files must list at least one payload file.')
  if (keys.length > DATABASE_PLUGIN_BOUNDS.maxFiles) bad('too_many_files', 'checksums.files exceeds the file limit.')
  for (const key of keys) {
    if (!isSafePayloadPath(key)) bad('unsafe_path', `checksums.files path "${key}" is not a safe relative payload path.`)
    const digest = files[key]
    if (typeof digest !== 'string' || !SHA256_HEX_PATTERN.test(digest)) {
      bad('invalid_manifest', `checksums.files["${key}"] must be a lowercase hex sha-256 digest.`)
    }
    entries[key] = digest
  }
  return { algorithm: 'sha-256', files: entries }
}

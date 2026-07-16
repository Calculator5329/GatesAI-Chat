export const DATABASE_PLUGIN_SCHEMA_VERSION = 1 as const

export const DATABASE_PLUGIN_LIMITS = {
  compressedBytes: 256 * 1024 * 1024,
  expandedBytes: 1024 * 1024 * 1024,
  files: 100,
  results: 50,
  transcriptCharacters: 32_000,
} as const

export const DATABASE_PLUGIN_CAPABILITIES = [
  'catalog.read',
  'schema.read',
  'lookup.read',
  'search.read',
] as const

export type DatabasePluginCapability = typeof DATABASE_PLUGIN_CAPABILITIES[number]
export type DatabasePluginDataPolicy = 'local_only' | 'cloud_allowed'
export type DatabasePluginScalarType = 'string' | 'integer' | 'number' | 'boolean'

export interface DatabasePluginParameter {
  name: string
  type: DatabasePluginScalarType
  required: boolean
  max_length?: number
  minimum?: number
  maximum?: number
}

export interface DatabasePluginProjection {
  name: string
  description: string
  parameters: DatabasePluginParameter[]
  result_fields: string[]
  max_results: number
  max_transcript_characters: number
}

export interface DatabasePluginDataset {
  id: string
  title: string
  description: string
  source: string
  record_id_field: string
  fields: Array<{
    name: string
    type: DatabasePluginScalarType
    description: string
  }>
  lookups: DatabasePluginProjection[]
  searches: DatabasePluginProjection[]
}

export interface DatabasePluginSignatureDescriptor {
  algorithm: 'ed25519'
  key_fingerprint: string
  signature_path: string
}

export interface DatabasePluginManifest {
  schema_version: typeof DATABASE_PLUGIN_SCHEMA_VERSION
  id: string
  version: string
  min_host_version: string
  min_schema_version: typeof DATABASE_PLUGIN_SCHEMA_VERSION
  publisher: {
    name: string
    url?: string
  }
  provenance: {
    source: string
    retrieved_at?: string
  }
  package: {
    compressed_size_bytes: number
    expanded_size_bytes: number
    file_count: number
  }
  datasets: DatabasePluginDataset[]
  citation_namespace: string
  license: {
    spdx: string
    notice_path: string
  }
  update: {
    catalog_id: string
    url: string
  }
  data_policy: DatabasePluginDataPolicy
  capabilities: DatabasePluginCapability[]
  signature?: DatabasePluginSignatureDescriptor
}

export type DatabasePluginSignatureStatus =
  | { kind: 'unsigned'; label: 'Unsigned' }
  | { kind: 'invalid'; label: 'Signature invalid' }
  | { kind: 'verified_untrusted'; label: 'Signature verified — signer not trusted'; fingerprint: string }
  | { kind: 'verified_trusted'; label: 'Signature verified — trusted signer'; fingerprint: string }

const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256_FINGERPRINT = /^sha256:[a-f0-9]{64}$/

export function parseDatabasePluginManifest(value: unknown): DatabasePluginManifest {
  const manifest = record(value, 'manifest')
  exactKeys(manifest, [
    'schema_version', 'id', 'version', 'min_host_version', 'min_schema_version',
    'publisher', 'provenance', 'package', 'datasets', 'citation_namespace',
    'license', 'update', 'data_policy', 'capabilities', 'signature',
  ], 'manifest')

  if (manifest.schema_version !== DATABASE_PLUGIN_SCHEMA_VERSION
    || manifest.min_schema_version !== DATABASE_PLUGIN_SCHEMA_VERSION) {
    fail('schema_version', 'must be exactly 1')
  }

  const id = identifier(manifest.id, 'id')
  const version = semver(manifest.version, 'version')
  const minHostVersion = semver(manifest.min_host_version, 'min_host_version')
  const publisher = parsePublisher(manifest.publisher)
  const provenance = parseProvenance(manifest.provenance)
  const packageBounds = parsePackageBounds(manifest.package)
  const citationNamespace = identifier(manifest.citation_namespace, 'citation_namespace')
  const license = parseLicense(manifest.license)
  const update = parseUpdate(manifest.update)
  const dataPolicy = oneOf(manifest.data_policy, ['local_only', 'cloud_allowed'], 'data_policy')
  const capabilities = uniqueArray(manifest.capabilities, 'capabilities', (entry, path) => (
    oneOf(entry, DATABASE_PLUGIN_CAPABILITIES, path)
  ))
  if (capabilities.length === 0) fail('capabilities', 'must contain at least one capability')

  const datasets = uniqueArray(manifest.datasets, 'datasets', parseDataset, dataset => dataset.id)
  if (datasets.length === 0) fail('datasets', 'must contain at least one dataset')
  const needsLookup = datasets.some(dataset => dataset.lookups.length > 0)
  const needsSearch = datasets.some(dataset => dataset.searches.length > 0)
  if (needsLookup && !capabilities.includes('lookup.read')) fail('capabilities', 'must include lookup.read')
  if (needsSearch && !capabilities.includes('search.read')) fail('capabilities', 'must include search.read')

  const signature = manifest.signature === undefined ? undefined : parseSignature(manifest.signature)

  return {
    schema_version: DATABASE_PLUGIN_SCHEMA_VERSION,
    id,
    version,
    min_host_version: minHostVersion,
    min_schema_version: DATABASE_PLUGIN_SCHEMA_VERSION,
    publisher,
    provenance,
    package: packageBounds,
    datasets,
    citation_namespace: citationNamespace,
    license,
    update,
    data_policy: dataPolicy,
    capabilities,
    ...(signature ? { signature } : {}),
  }
}

export function describeDatabasePluginSignature(input: {
  descriptor?: DatabasePluginSignatureDescriptor
  signatureVerified: boolean
  signerTrusted: boolean
}): DatabasePluginSignatureStatus {
  if (!input.descriptor) return { kind: 'unsigned', label: 'Unsigned' }
  if (!input.signatureVerified) return { kind: 'invalid', label: 'Signature invalid' }
  if (!input.signerTrusted) {
    return {
      kind: 'verified_untrusted',
      label: 'Signature verified — signer not trusted',
      fingerprint: input.descriptor.key_fingerprint,
    }
  }
  return {
    kind: 'verified_trusted',
    label: 'Signature verified — trusted signer',
    fingerprint: input.descriptor.key_fingerprint,
  }
}

function parsePublisher(value: unknown): DatabasePluginManifest['publisher'] {
  const entry = record(value, 'publisher')
  exactKeys(entry, ['name', 'url'], 'publisher')
  const name = text(entry.name, 'publisher.name', 1, 200)
  if (entry.url === undefined) return { name }
  return { name, url: httpsUrl(entry.url, 'publisher.url') }
}

function parseProvenance(value: unknown): DatabasePluginManifest['provenance'] {
  const entry = record(value, 'provenance')
  exactKeys(entry, ['source', 'retrieved_at'], 'provenance')
  const source = text(entry.source, 'provenance.source', 1, 500)
  if (entry.retrieved_at === undefined) return { source }
  const retrievedAt = text(entry.retrieved_at, 'provenance.retrieved_at', 1, 64)
  if (!Number.isFinite(Date.parse(retrievedAt))) fail('provenance.retrieved_at', 'must be an ISO date-time')
  return { source, retrieved_at: retrievedAt }
}

function parsePackageBounds(value: unknown): DatabasePluginManifest['package'] {
  const entry = record(value, 'package')
  exactKeys(entry, ['compressed_size_bytes', 'expanded_size_bytes', 'file_count'], 'package')
  const compressed = boundedInteger(entry.compressed_size_bytes, 'package.compressed_size_bytes', 1, DATABASE_PLUGIN_LIMITS.compressedBytes)
  const expanded = boundedInteger(entry.expanded_size_bytes, 'package.expanded_size_bytes', 1, DATABASE_PLUGIN_LIMITS.expandedBytes)
  if (expanded < compressed) fail('package.expanded_size_bytes', 'must not be smaller than compressed_size_bytes')
  return {
    compressed_size_bytes: compressed,
    expanded_size_bytes: expanded,
    file_count: boundedInteger(entry.file_count, 'package.file_count', 1, DATABASE_PLUGIN_LIMITS.files),
  }
}

function parseLicense(value: unknown): DatabasePluginManifest['license'] {
  const entry = record(value, 'license')
  exactKeys(entry, ['spdx', 'notice_path'], 'license')
  return {
    spdx: text(entry.spdx, 'license.spdx', 1, 100),
    notice_path: packagePath(entry.notice_path, 'license.notice_path', 'LICENSES/'),
  }
}

function parseUpdate(value: unknown): DatabasePluginManifest['update'] {
  const entry = record(value, 'update')
  exactKeys(entry, ['catalog_id', 'url'], 'update')
  return {
    catalog_id: identifier(entry.catalog_id, 'update.catalog_id'),
    url: httpsUrl(entry.url, 'update.url'),
  }
}

function parseDataset(value: unknown, path: string): DatabasePluginDataset {
  const entry = record(value, path)
  exactKeys(entry, ['id', 'title', 'description', 'source', 'record_id_field', 'fields', 'lookups', 'searches'], path)
  const fields = uniqueArray(entry.fields, `${path}.fields`, (field, fieldPath) => {
    const item = record(field, fieldPath)
    exactKeys(item, ['name', 'type', 'description'], fieldPath)
    return {
      name: fieldName(item.name, `${fieldPath}.name`),
      type: oneOf(item.type, ['string', 'integer', 'number', 'boolean'], `${fieldPath}.type`),
      description: text(item.description, `${fieldPath}.description`, 1, 500),
    }
  }, field => field.name)
  if (fields.length === 0) fail(`${path}.fields`, 'must contain at least one field')
  const fieldNames = new Set(fields.map(field => field.name))
  const recordIdField = fieldName(entry.record_id_field, `${path}.record_id_field`)
  if (!fieldNames.has(recordIdField)) fail(`${path}.record_id_field`, 'must name a declared field')

  const parseProjection = (projection: unknown, projectionPath: string): DatabasePluginProjection => {
    const item = record(projection, projectionPath)
    exactKeys(item, ['name', 'description', 'parameters', 'result_fields', 'max_results', 'max_transcript_characters'], projectionPath)
    const resultFields = uniqueArray(item.result_fields, `${projectionPath}.result_fields`, fieldName)
    if (resultFields.length === 0 || resultFields.some(field => !fieldNames.has(field))) {
      fail(`${projectionPath}.result_fields`, 'must contain only declared fields')
    }
    return {
      name: identifier(item.name, `${projectionPath}.name`),
      description: text(item.description, `${projectionPath}.description`, 1, 500),
      parameters: uniqueArray(item.parameters, `${projectionPath}.parameters`, parseParameter, parameter => parameter.name),
      result_fields: resultFields,
      max_results: boundedInteger(item.max_results, `${projectionPath}.max_results`, 1, DATABASE_PLUGIN_LIMITS.results),
      max_transcript_characters: boundedInteger(item.max_transcript_characters, `${projectionPath}.max_transcript_characters`, 1, DATABASE_PLUGIN_LIMITS.transcriptCharacters),
    }
  }

  return {
    id: identifier(entry.id, `${path}.id`),
    title: text(entry.title, `${path}.title`, 1, 200),
    description: text(entry.description, `${path}.description`, 1, 1_000),
    source: packagePath(entry.source, `${path}.source`, 'data/', '.sqlite'),
    record_id_field: recordIdField,
    fields,
    lookups: uniqueArray(entry.lookups, `${path}.lookups`, parseProjection, projection => projection.name),
    searches: uniqueArray(entry.searches, `${path}.searches`, parseProjection, projection => projection.name),
  }
}

function parseParameter(value: unknown, path: string): DatabasePluginParameter {
  const entry = record(value, path)
  exactKeys(entry, ['name', 'type', 'required', 'max_length', 'minimum', 'maximum'], path)
  const type = oneOf(entry.type, ['string', 'integer', 'number', 'boolean'], `${path}.type`)
  if (typeof entry.required !== 'boolean') fail(`${path}.required`, 'must be a boolean')
  const parameter: DatabasePluginParameter = {
    name: fieldName(entry.name, `${path}.name`),
    type,
    required: entry.required,
  }
  if (type === 'string') {
    parameter.max_length = boundedInteger(entry.max_length, `${path}.max_length`, 1, 2_000)
    if (entry.minimum !== undefined || entry.maximum !== undefined) fail(path, 'string parameters cannot declare numeric bounds')
  } else if (type === 'integer' || type === 'number') {
    if (entry.max_length !== undefined) fail(path, 'numeric parameters cannot declare max_length')
    parameter.minimum = finiteNumber(entry.minimum, `${path}.minimum`)
    parameter.maximum = finiteNumber(entry.maximum, `${path}.maximum`)
    if (parameter.minimum > parameter.maximum) fail(path, 'minimum must not exceed maximum')
  } else if (entry.max_length !== undefined || entry.minimum !== undefined || entry.maximum !== undefined) {
    fail(path, 'boolean parameters cannot declare bounds')
  }
  return parameter
}

function parseSignature(value: unknown): DatabasePluginSignatureDescriptor {
  const entry = record(value, 'signature')
  exactKeys(entry, ['algorithm', 'key_fingerprint', 'signature_path'], 'signature')
  if (entry.algorithm !== 'ed25519') fail('signature.algorithm', 'must be ed25519')
  const fingerprint = text(entry.key_fingerprint, 'signature.key_fingerprint', 1, 100)
  if (!SHA256_FINGERPRINT.test(fingerprint)) fail('signature.key_fingerprint', 'must be a lowercase SHA-256 fingerprint')
  return {
    algorithm: 'ed25519',
    key_fingerprint: fingerprint,
    signature_path: packagePath(entry.signature_path, 'signature.signature_path', 'SIGNATURES/'),
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected) fail(`${path}.${unexpected}`, 'is not allowed by schema 1')
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value) {
    fail(path, `must be a trimmed string from ${min} to ${max} characters`)
  }
  return value
}

function identifier(value: unknown, path: string): string {
  const parsed = text(value, path, 1, 128)
  if (!IDENTIFIER.test(parsed)) fail(path, 'must be a lowercase stable identifier')
  return parsed
}

function fieldName(value: unknown, path: string): string {
  const parsed = text(value, path, 1, 128)
  if (!FIELD_NAME.test(parsed)) fail(path, 'must be a safe field name')
  return parsed
}

function semver(value: unknown, path: string): string {
  const parsed = text(value, path, 5, 100)
  if (!SEMVER.test(parsed)) fail(path, 'must be semantic version x.y.z')
  return parsed
}

function httpsUrl(value: unknown, path: string): string {
  const parsed = text(value, path, 1, 2_000)
  let url: URL
  try {
    url = new URL(parsed)
  } catch {
    fail(path, 'must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password) fail(path, 'must be a credential-free HTTPS URL')
  return url.toString()
}

function packagePath(value: unknown, path: string, prefix: string, suffix?: string): string {
  const parsed = text(value, path, 1, 500)
  if (parsed.includes('\\') || parsed.startsWith('/') || parsed.split('/').some(part => part === '' || part === '.' || part === '..')) {
    fail(path, 'must be a normalized relative package path')
  }
  if (!parsed.startsWith(prefix) || (suffix && !parsed.endsWith(suffix))) fail(path, `must stay under ${prefix}${suffix ? ` and end in ${suffix}` : ''}`)
  return parsed
}

function boundedInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(path, `must be an integer from ${min} to ${max}`)
  return value as number
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number')
  return value
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `must be one of: ${allowed.join(', ')}`)
  return value as T
}

function uniqueArray<T>(
  value: unknown,
  path: string,
  parse: (entry: unknown, path: string) => T,
  key: (entry: T) => string = entry => String(entry),
): T[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
  const parsed = value.map((entry, index) => parse(entry, `${path}[${index}]`))
  const seen = new Set<string>()
  for (const entry of parsed) {
    const identity = key(entry)
    if (seen.has(identity)) fail(path, `contains duplicate ${identity}`)
    seen.add(identity)
  }
  return parsed
}

function fail(path: string, message: string): never {
  throw new Error(`Database plugin ${path} ${message}`)
}

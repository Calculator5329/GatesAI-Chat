export const OFFLINE_LIBRARY_PLUGIN_ID = 'local.offline-library'
export const OFFLINE_LIBRARY_SCHEMA_VERSION = 1
export const OFFLINE_LIBRARY_PLUGIN_MAJOR = 1

export type OfflineLibraryResource =
  | 'plugin'
  | 'status'
  | 'sources'
  | 'evaluations'
  | 'profiles'
  | 'knowledge_arena'
  | 'databases'
  | 'public_schema'

export type OfflineLibrarySearchMode = 'fulltext' | 'semantic' | 'hybrid'

export interface OfflineLibrarySearchRequest {
  query: string
  limit: number
  mode: OfflineLibrarySearchMode
  includeKiwix: boolean
}

export interface OfflineLibraryError {
  kind: 'web_lite' | 'unavailable' | 'timeout' | 'invalid_request' | 'redirect'
    | 'too_large' | 'invalid_content_type' | 'invalid_json' | 'http' | 'transport'
    | 'incompatible' | 'unknown'
  status?: number
  message: string
}

export type OfflineLibraryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: OfflineLibraryError }

export interface OfflineLibraryPluginManifest {
  schema_version: number
  id: string
  version: string
  transport: {
    base_url: string
    backend_proxy_required_for_webviews: boolean
    redirects: boolean
    max_response_bytes: number
  }
  capabilities: string[]
  safety: Record<string, boolean>
}

export interface OfflineLibraryStatus {
  api_version: string
  generated_at: string
  library: Record<string, unknown>
  services: Record<string, unknown>
  catalog: Record<string, number>
  collections: Array<Record<string, unknown>>
}

export interface OfflineLibrarySource {
  name: string
  kind: string
  license: string | null
  version: string | null
  enabled: boolean
  document_count: number
  provenance: { url?: string; sha256?: string; size_bytes?: number }
}

export interface OfflineLibrarySources {
  api_version: string
  sources: OfflineLibrarySource[]
}

export interface OfflineLibraryDatabases {
  api_version: string
  databases: Array<{
    alias: string
    description: string
    sensitivity: 'public'
    enabled: boolean
    available: boolean
    access: 'read_only'
  }>
  query_endpoint_available: false
}

export interface OfflineLibraryPublicSchema {
  api_version: string
  database: {
    alias: string
    description: string
    sensitivity: 'public'
    health: 'ok'
    objects: unknown[]
  }
  query_endpoint_available: false
}

export interface OfflineLibraryProfiles {
  schema_version: 1
  plugin_version: string
  source_run: string
  source_run_trials: number
  source_run_cells: number
  local_only: true
  remote_fallback: false
  selection: Record<string, string>
  profiles: OfflineLibraryProfile[]
}

export interface OfflineLibraryProfile {
  id: string
  label: string
  task_kind: string
  model: string
  retrieval: {
    strategy: string
    mode: string
    include_kiwix: boolean
  }
  evidence: {
    trials: number
    average_score: number
    score_confidence_95: { low: number; high: number }
    source_hit_rate: number
    expected_term_recall: number
    citation_validity_rate: number
    average_retrieval_latency_ms: number
    average_generation_latency_ms: number
    error_count: number
  }
  limitations: string[]
}

export interface OfflineLibraryKnowledgeArena {
  api_version: string
  available: boolean
  run?: Record<string, unknown>
  scoring?: Record<string, number>
  summaries?: {
    model?: OfflineLibraryBenchmarkSummary[]
    strategy?: OfflineLibraryBenchmarkSummary[]
    dataset?: OfflineLibraryBenchmarkSummary[]
  }
  cells?: OfflineLibraryBenchmarkCell[]
  reason?: string
}

export interface OfflineLibraryBenchmarkSummary {
  name: string
  trials: number
  averageScore: number
  scoreConfidence95: { low: number; high: number }
  sourceHitRate: number
  citationValidityRate: number
  averageTermRecall: number
  averageRetrievalLatencyMs: number
  averageGenerationLatencyMs: number
  averageLatencyMs: number
  trust?: {
    citationPresenceRate?: number
    noCitationRate?: number
    unsupportedCitationTrialRate?: number
    supportedCitationReferenceRate?: number
    errorRate?: number
  }
}

export interface OfflineLibraryBenchmarkCell extends Omit<OfflineLibraryBenchmarkSummary, 'name' | 'trust'> {
  model: string
  strategy: string
  task_id: string
  dataset: string
}

export interface OfflineLibrarySearchResponse {
  api_version: string
  query: string
  mode: OfflineLibrarySearchMode
  matches: Array<Record<string, unknown>>
}

export function validateOfflineLibraryManifest(value: unknown): OfflineLibraryPluginManifest {
  if (!isRecord(value)) throw new Error('Offline Library manifest must be an object')
  if (value.schema_version !== OFFLINE_LIBRARY_SCHEMA_VERSION) {
    throw new Error('Offline Library schema version is incompatible')
  }
  if (value.id !== OFFLINE_LIBRARY_PLUGIN_ID || typeof value.version !== 'string') {
    throw new Error('Offline Library plugin identity is incompatible')
  }
  const major = Number.parseInt(value.version.split('.')[0] ?? '', 10)
  if (major !== OFFLINE_LIBRARY_PLUGIN_MAJOR) {
    throw new Error('Offline Library plugin major version is incompatible')
  }
  if (!isRecord(value.transport)
    || value.transport.base_url !== 'http://127.0.0.1:8892/api/v1'
    || value.transport.backend_proxy_required_for_webviews !== true
    || value.transport.redirects !== false
    || value.transport.max_response_bytes !== 1_000_000) {
    throw new Error('Offline Library transport contract is incompatible')
  }
  if (!Array.isArray(value.capabilities) || !isRecord(value.safety)) {
    throw new Error('Offline Library capabilities or safety policy are invalid')
  }
  return value as unknown as OfflineLibraryPluginManifest
}

export function validateOfflineLibrarySearch(request: OfflineLibrarySearchRequest): void {
  const length = Array.from(request.query).length
  if (!request.query.trim() || length > 2_000) throw new Error('Query must contain 1 to 2000 characters')
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20) {
    throw new Error('Search limit must be from 1 to 20')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

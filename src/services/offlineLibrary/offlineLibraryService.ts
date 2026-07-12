import { invoke } from '@tauri-apps/api/core'
import {
  type OfflineLibraryDatabases,
  type OfflineLibraryError,
  type OfflineLibraryKnowledgeArena,
  type OfflineLibraryPluginManifest,
  type OfflineLibraryProfiles,
  type OfflineLibraryPublicSchema,
  type OfflineLibraryResource,
  type OfflineLibraryResult,
  type OfflineLibrarySearchRequest,
  type OfflineLibrarySearchResponse,
  type OfflineLibrarySources,
  type OfflineLibraryStatus,
  validateOfflineLibraryManifest,
  validateOfflineLibrarySearch,
} from '../../core/offlineLibrary'
import { isTauri } from '../../core/runtime'

export interface OfflineLibraryService {
  getPlugin(): Promise<OfflineLibraryResult<OfflineLibraryPluginManifest>>
  getStatus(): Promise<OfflineLibraryResult<OfflineLibraryStatus>>
  getSources(): Promise<OfflineLibraryResult<OfflineLibrarySources>>
  getEvaluations(): Promise<OfflineLibraryResult<Record<string, unknown>>>
  getProfiles(): Promise<OfflineLibraryResult<OfflineLibraryProfiles>>
  getKnowledgeArena(): Promise<OfflineLibraryResult<OfflineLibraryKnowledgeArena>>
  getDatabases(): Promise<OfflineLibraryResult<OfflineLibraryDatabases>>
  getPublicSchema(alias: string): Promise<OfflineLibraryResult<OfflineLibraryPublicSchema>>
  search(request: OfflineLibrarySearchRequest): Promise<OfflineLibraryResult<OfflineLibrarySearchResponse>>
}

export const offlineLibraryService: OfflineLibraryService = {
  async getPlugin() {
    const result = await read<unknown>('plugin')
    if (!result.ok) return result
    try {
      return { ok: true, data: validateOfflineLibraryManifest(result.data) }
    } catch (error) {
      return failure('incompatible', error)
    }
  },
  getStatus: () => read('status'),
  getSources: () => read('sources'),
  getEvaluations: () => read('evaluations'),
  getProfiles: () => read('profiles'),
  getKnowledgeArena: () => read('knowledge_arena'),
  getDatabases: () => read('databases'),
  getPublicSchema: (alias) => read('public_schema', alias),
  async search(request) {
    if (!isTauri()) return webLiteFailure()
    try {
      validateOfflineLibrarySearch(request)
    } catch (error) {
      return failure('invalid_request', error)
    }
    try {
      const data = await invoke<OfflineLibrarySearchResponse>('offline_library_search', { request })
      return { ok: true, data }
    } catch (error) {
      return normalizeFailure(error)
    }
  },
}

async function read<T>(resource: OfflineLibraryResource, alias?: string): Promise<OfflineLibraryResult<T>> {
  if (!isTauri()) return webLiteFailure()
  try {
    const data = await invoke<T>('offline_library_read', { resource, alias })
    return { ok: true, data }
  } catch (error) {
    return normalizeFailure(error)
  }
}

function webLiteFailure<T>(): OfflineLibraryResult<T> {
  return {
    ok: false,
    error: {
      kind: 'web_lite',
      message: 'Offline Library is available only in the GatesAI desktop app.',
    },
  }
}

function normalizeFailure<T>(error: unknown): OfflineLibraryResult<T> {
  if (isErrorShape(error)) {
    return {
      ok: false,
      error: { kind: normalizeKind(error.kind), status: error.status, message: error.message },
    }
  }
  return failure('unknown', error)
}

function failure<T>(kind: OfflineLibraryError['kind'], error: unknown): OfflineLibraryResult<T> {
  return {
    ok: false,
    error: { kind, message: error instanceof Error ? error.message : String(error) },
  }
}

function isErrorShape(value: unknown): value is { kind: string; status?: number; message: string } {
  return typeof value === 'object' && value !== null
    && typeof Reflect.get(value, 'kind') === 'string'
    && typeof Reflect.get(value, 'message') === 'string'
    && (Reflect.get(value, 'status') === undefined || typeof Reflect.get(value, 'status') === 'number')
}

function normalizeKind(kind: string): OfflineLibraryError['kind'] {
  const known: OfflineLibraryError['kind'][] = [
    'unavailable', 'timeout', 'invalid_request', 'redirect', 'too_large',
    'invalid_content_type', 'invalid_json', 'http', 'transport', 'incompatible',
  ]
  return known.includes(kind as OfflineLibraryError['kind'])
    ? kind as OfflineLibraryError['kind']
    : 'unknown'
}

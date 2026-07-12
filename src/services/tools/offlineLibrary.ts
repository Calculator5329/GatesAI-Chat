import type {
  OfflineLibraryError,
  OfflineLibrarySearchRequest,
} from '../../core/offlineLibrary'
import type { Tool, ToolExecuteResult, ToolValidationIssue } from './types'

const SEARCH_LIMIT_DEFAULT = 5
const SEARCH_LIMIT_MAX = 10
const PUBLIC_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const librarySearchTool: Tool = {
  def: {
    name: 'library_search',
    description: 'Search the explicitly enabled local Offline Library. Returns bounded excerpts with exact local citation URIs such as kiwix://, library://, man:, or db://. Read-only; never falls back to the web or a remote model.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search question or terms (1–2000 characters).' },
        limit: { type: 'number', description: `Maximum cited matches (1–${SEARCH_LIMIT_MAX}, default ${SEARCH_LIMIT_DEFAULT}).` },
        mode: { type: 'string', enum: ['fulltext', 'semantic', 'hybrid'], description: 'Local retrieval mode.' },
        include_kiwix: { type: 'boolean', description: 'Include installed Kiwix archives. Defaults true.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  meta: {
    category: 'knowledge', capabilityId: 'search.read', risk: 'low',
    isReadOnly: () => true, hasSideEffects: () => false,
    resultPolicy: { maxChars: 24_000, summarizeLargeOutput: false },
    validate: validateSearchArgs,
  },
  async execute(args, ctx) {
    const library = ctx.offlineLibrary
    if (!library?.available) return unavailable('library_search')
    const request: OfflineLibrarySearchRequest = {
      query: String(args.query).trim(),
      limit: typeof args.limit === 'number' ? Math.floor(args.limit) : SEARCH_LIMIT_DEFAULT,
      mode: args.mode === 'fulltext' || args.mode === 'semantic' ? args.mode : 'hybrid',
      includeKiwix: args.include_kiwix !== false,
    }
    const result = await library.search(request)
    if (!result.ok) return toolFailure('library_search', result.error)
    const matches = result.data.matches.slice(0, request.limit).map(match => ({
      title: stringField(match, 'title', 300),
      uri: stringField(match, 'uri', 2_000),
      excerpt: stringField(match, 'excerpt', 1_500),
      source: stringField(match, 'source', 300),
      retrieval: stringField(match, 'retrieval', 100),
      score: numberField(match, 'score'),
    }))
    return success('library_search', `Found ${matches.length} cited local match${matches.length === 1 ? '' : 'es'}.`, {
      query: result.data.query, mode: result.data.mode, matches,
    })
  },
}

export const librarySourcesTool: Tool = {
  def: {
    name: 'library_sources',
    description: 'List installed Offline Library sources and approved public database aliases. Returns metadata only—never paths, private/restricted aliases, rows, or query access.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  meta: {
    category: 'knowledge', capabilityId: 'sources.read', risk: 'low',
    isReadOnly: () => true, hasSideEffects: () => false,
    resultPolicy: { maxChars: 20_000, summarizeLargeOutput: false },
  },
  async execute(_args, ctx) {
    const library = ctx.offlineLibrary
    if (!library?.available) return unavailable('library_sources')
    const [sources, databases] = await Promise.all([library.getSources(), library.getDatabases()])
    if (!sources.ok) return toolFailure('library_sources', sources.error)
    if (!databases.ok) return toolFailure('library_sources', databases.error)
    return success('library_sources', `Listed ${sources.data.sources.length} sources and ${databases.data.databases.length} public databases.`, {
      sources: sources.data.sources.slice(0, 40),
      public_databases: databases.data.databases.slice(0, 40),
      database_rows_available: false,
    })
  },
}

export const publicDatabaseSchemaTool: Tool = {
  def: {
    name: 'public_database_schema',
    description: 'Read the schema of one approved public Offline Library database alias. Schema metadata only: no rows, SQL, filesystem paths, private aliases, or mutations.',
    parameters: {
      type: 'object',
      properties: { alias: { type: 'string', description: 'Public alias from library_sources.' } },
      required: ['alias'], additionalProperties: false,
    },
  },
  meta: {
    category: 'knowledge', capabilityId: 'databases.public_schema.read', risk: 'low',
    isReadOnly: () => true, hasSideEffects: () => false,
    resultPolicy: { maxChars: 20_000, summarizeLargeOutput: false },
    validate: args => validatePublicAlias(args.alias),
  },
  async execute(args, ctx) {
    const library = ctx.offlineLibrary
    if (!library?.available) return unavailable('public_database_schema')
    const result = await library.getPublicSchema(String(args.alias))
    if (!result.ok) return toolFailure('public_database_schema', result.error)
    return success('public_database_schema', `Read public schema for ${result.data.database.alias}.`, {
      ...result.data,
      database: { ...result.data.database, objects: result.data.database.objects.slice(0, 50) },
    })
  },
}

export const knowledgeBenchmarksTool: Tool = {
  def: {
    name: 'knowledge_benchmarks',
    description: 'Inspect task-aware local profiles or aggregate Knowledge Arena benchmark summaries. Evidence includes samples, confidence intervals, grounding proxies, latency, and errors; it is not a factual hallucination rate.',
    parameters: {
      type: 'object',
      properties: { view: { type: 'string', enum: ['profiles', 'summary'], description: 'Profiles or aggregate benchmark summary.' } },
      required: ['view'], additionalProperties: false,
    },
  },
  meta: {
    category: 'knowledge', capabilityId: 'benchmarks.knowledge_arena.read', risk: 'low',
    isReadOnly: () => true, hasSideEffects: () => false,
    resultPolicy: { maxChars: 24_000, summarizeLargeOutput: false },
  },
  async execute(args, ctx) {
    const library = ctx.offlineLibrary
    if (!library?.available) return unavailable('knowledge_benchmarks')
    if (args.view === 'profiles') {
      const result = await library.getProfiles()
      if (!result.ok) return toolFailure('knowledge_benchmarks', result.error)
      return success('knowledge_benchmarks', `Listed ${result.data.profiles.length} task-aware profiles.`, result.data)
    }
    const result = await library.getKnowledgeArena()
    if (!result.ok) return toolFailure('knowledge_benchmarks', result.error)
    return success('knowledge_benchmarks', 'Read aggregate Knowledge Arena summary; raw answers and evidence passages are excluded.', {
      api_version: result.data.api_version,
      available: result.data.available,
      run: result.data.run,
      scoring: result.data.scoring,
      summaries: result.data.summaries,
      reason: result.data.reason,
      trust_label: 'Citation-grounding proxies; not factual hallucination judgments.',
    })
  },
}

function validateSearchArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query || Array.from(query).length > 2_000) {
    return issue('invalid_query', 'Library search query must contain 1 to 2000 characters.')
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > SEARCH_LIMIT_MAX)) {
    return issue('invalid_limit', `Library search limit must be an integer from 1 to ${SEARCH_LIMIT_MAX}.`)
  }
  return null
}

function validatePublicAlias(value: unknown): ToolValidationIssue | null {
  if (typeof value !== 'string' || !PUBLIC_ALIAS.test(value)) {
    return issue('invalid_public_alias', 'Public database alias must match [a-z0-9][a-z0-9_-]{0,63}.')
  }
  return null
}

function issue(errorCode: string, summary: string): ToolValidationIssue {
  return { errorCode, summary, fix: 'Use the bounded values described by this read-only tool.', retryable: true }
}

function success(tool: string, summary: string, data: unknown): ToolExecuteResult {
  return { ok: true, summary, content: `status: ok\ntool: ${tool}\nsummary: ${summary}\ndata: ${JSON.stringify(data)}`, data }
}

function unavailable(tool: string): ToolExecuteResult {
  return {
    ok: false, errorCode: 'offline_library_unavailable', retryable: true,
    summary: 'Offline Library is disabled, unhealthy, or unavailable.',
    content: `status: error\ntool: ${tool}\nerror_code: offline_library_unavailable\nsummary: Offline Library is disabled, unhealthy, or unavailable.\nfix: Enable the addon in Settings and confirm the local host is healthy.\nretryable: true`,
  }
}

function toolFailure(tool: string, error: OfflineLibraryError): ToolExecuteResult {
  const retryable = error.kind !== 'incompatible' && error.status !== 404
  return {
    ok: false, errorCode: `offline_library_${error.kind}`, retryable, summary: error.message,
    content: `status: error\ntool: ${tool}\nerror_code: offline_library_${error.kind}\nsummary: ${error.message}\nretryable: ${retryable ? 'true' : 'false'}`,
  }
}

function stringField(record: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

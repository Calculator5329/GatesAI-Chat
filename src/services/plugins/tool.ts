// Model-facing tool facade for database plugins. These are the narrow, bounded
// operations an agent may call through the existing tool/capability seam:
// list, search, lookup, schema, and propose_install. Every result is
// size-capped with stable `gatesdb://` citations; install/enable/archive are
// never performed here — propose_install only creates a user-visible proposal.
//
// The factory closes over a facade instead of reading a ToolContext field, so
// these tools are testable in isolation and ready for the wiring lane to
// register without this slice editing the shared registry or ToolContext.
import type { Tool, ToolExecuteResult, ToolValidationIssue } from '../tools/types'
import type { RouteDescriptor } from './policy'
import type {
  DatabasePluginError,
  DatabasePluginLookupRequest,
  DatabasePluginQueryResponse,
  DatabasePluginResult,
  DatabasePluginSearchRequest,
  InstalledDatabasePlugin,
} from './types'
import { DATABASE_PLUGIN_BOUNDS, PLUGIN_ID_PATTERN, PLUGIN_MEMBER_ID_PATTERN } from './bounds'

/** The bounded surface the tools need. Implemented by a store/service adapter. */
export interface DatabasePluginToolFacade {
  /** The resolved route for the current run (used for the local/cloud gate). */
  route(): RouteDescriptor
  list(): Promise<DatabasePluginResult<InstalledDatabasePlugin[]>>
  search(request: DatabasePluginSearchRequest, route: RouteDescriptor): Promise<DatabasePluginResult<DatabasePluginQueryResponse>>
  lookup(request: DatabasePluginLookupRequest, route: RouteDescriptor): Promise<DatabasePluginResult<DatabasePluginQueryResponse>>
}

const RESULT_POLICY = { maxChars: DATABASE_PLUGIN_BOUNDS.maxTranscriptChars, summarizeLargeOutput: false }

export function createDatabasePluginTools(facade: DatabasePluginToolFacade): Tool[] {
  return [listTool(facade), searchTool(facade), lookupTool(facade), schemaTool(facade), proposeInstallTool()]
}

function listTool(facade: DatabasePluginToolFacade): Tool {
  return {
    def: {
      name: 'database_plugins_list',
      description: 'List installed, enabled local database plugins and their datasets. Metadata only — no rows, file paths, or SQLite internals. Read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    meta: {
      category: 'knowledge', capabilityId: 'catalog.read', risk: 'low',
      isReadOnly: () => true, hasSideEffects: () => false, resultPolicy: RESULT_POLICY,
    },
    async execute() {
      const result = await facade.list()
      if (!result.ok) return failure('database_plugins_list', result.error)
      const plugins = result.data.map(p => ({
        id: p.id,
        version: p.version,
        description: p.manifest.description,
        publisher: p.manifest.publisher.name,
        enabled: p.enabled,
        data_policy: p.effectiveDataPolicy,
        capabilities: p.manifest.capabilities,
        datasets: p.manifest.datasets.map(d => ({
          id: d.id,
          title: d.title,
          searches: (d.searches ?? []).map(s => s.id),
          lookups: (d.lookups ?? []).map(l => l.id),
        })),
      }))
      return success('database_plugins_list', `Listed ${plugins.length} installed database plugin${plugins.length === 1 ? '' : 's'}.`, { plugins })
    },
  }
}

function searchTool(facade: DatabasePluginToolFacade): Tool {
  return {
    def: {
      name: 'database_plugins_search',
      description: 'Bounded text search over one enabled local database plugin dataset. Returns capped evidence rows with stable gatesdb:// citations. Read-only; local-only bundles block on a cloud model.',
      parameters: {
        type: 'object',
        properties: {
          plugin_id: { type: 'string', description: 'Installed plugin id from database_plugins_list.' },
          dataset_id: { type: 'string', description: 'Dataset id declared by that plugin.' },
          search_id: { type: 'string', description: 'Optional named search projection; defaults to the dataset\'s first.' },
          query: { type: 'string', description: `Search terms (1–${DATABASE_PLUGIN_BOUNDS.maxQueryLength} characters).` },
          limit: { type: 'number', description: `Maximum rows (1–${DATABASE_PLUGIN_BOUNDS.maxResults}).` },
        },
        required: ['plugin_id', 'dataset_id', 'query'],
        additionalProperties: false,
      },
    },
    meta: {
      category: 'knowledge', capabilityId: 'search.read', risk: 'low',
      isReadOnly: () => true, hasSideEffects: () => false, resultPolicy: RESULT_POLICY,
      validate: validateSearchArgs,
    },
    async execute(args) {
      const request: DatabasePluginSearchRequest = {
        pluginId: String(args.plugin_id),
        datasetId: String(args.dataset_id),
        query: String(args.query),
      }
      if (typeof args.search_id === 'string') request.searchId = args.search_id
      if (typeof args.limit === 'number') request.limit = args.limit
      const result = await facade.search(request, facade.route())
      if (!result.ok) return failure('database_plugins_search', result.error)
      return queryResult('database_plugins_search', result.data)
    },
  }
}

function lookupTool(facade: DatabasePluginToolFacade): Tool {
  return {
    def: {
      name: 'database_plugins_lookup',
      description: 'Named lookup over one enabled dataset with typed scalar parameters (no SQL). Returns capped evidence rows with gatesdb:// citations. Read-only; local-only bundles block on a cloud model.',
      parameters: {
        type: 'object',
        properties: {
          plugin_id: { type: 'string', description: 'Installed plugin id.' },
          dataset_id: { type: 'string', description: 'Dataset id.' },
          lookup_id: { type: 'string', description: 'Named lookup projection declared by the dataset.' },
          parameters: { type: 'object', description: 'Typed scalar parameters declared by the lookup.', additionalProperties: true },
        },
        required: ['plugin_id', 'dataset_id', 'lookup_id'],
        additionalProperties: false,
      },
    },
    meta: {
      category: 'knowledge', capabilityId: 'lookup.read', risk: 'low',
      isReadOnly: () => true, hasSideEffects: () => false, resultPolicy: RESULT_POLICY,
      validate: validateLookupArgs,
    },
    async execute(args) {
      const rawParams = (typeof args.parameters === 'object' && args.parameters !== null)
        ? args.parameters as Record<string, unknown>
        : {}
      const parameters: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(rawParams)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') parameters[key] = value
      }
      const request: DatabasePluginLookupRequest = {
        pluginId: String(args.plugin_id),
        datasetId: String(args.dataset_id),
        lookupId: String(args.lookup_id),
        parameters,
      }
      const result = await facade.lookup(request, facade.route())
      if (!result.ok) return failure('database_plugins_lookup', result.error)
      return queryResult('database_plugins_lookup', result.data)
    },
  }
}

function schemaTool(facade: DatabasePluginToolFacade): Tool {
  return {
    def: {
      name: 'database_plugins_schema',
      description: 'Read the published field descriptions of one installed database plugin: datasets, lookups, and search projections. Never exposes private SQLite internals or rows.',
      parameters: {
        type: 'object',
        properties: { plugin_id: { type: 'string', description: 'Installed plugin id.' } },
        required: ['plugin_id'],
        additionalProperties: false,
      },
    },
    meta: {
      category: 'knowledge', capabilityId: 'schema.read', risk: 'low',
      isReadOnly: () => true, hasSideEffects: () => false, resultPolicy: RESULT_POLICY,
      validate: args => validatePluginId(args.plugin_id),
    },
    async execute(args) {
      const result = await facade.list()
      if (!result.ok) return failure('database_plugins_schema', result.error)
      const plugin = result.data.find(p => p.id === String(args.plugin_id))
      if (!plugin) {
        return {
          ok: false, errorCode: 'database_plugins_not_found', retryable: false,
          summary: `No installed plugin "${String(args.plugin_id)}".`,
          content: `status: error\ntool: database_plugins_schema\nerror_code: database_plugins_not_found\nsummary: No installed plugin "${String(args.plugin_id)}".\nretryable: false`,
        }
      }
      return success('database_plugins_schema', `Read schema for ${plugin.id}@${plugin.version}.`, {
        id: plugin.id,
        version: plugin.version,
        data_policy: plugin.effectiveDataPolicy,
        capabilities: plugin.manifest.capabilities,
        datasets: plugin.manifest.datasets.map(d => ({
          id: d.id,
          title: d.title,
          description: d.description,
          approx_records: d.approxRecords,
          searches: (d.searches ?? []).map(s => ({ id: s.id, description: s.description })),
          lookups: (d.lookups ?? []).map(l => ({
            id: l.id,
            description: l.description,
            parameters: l.parameters.map(p => ({ name: p.name, type: p.type, required: p.required ?? false })),
          })),
        })),
      })
    },
  }
}

function proposeInstallTool(): Tool {
  return {
    def: {
      name: 'database_plugins_propose_install',
      description: 'Create a user-visible proposal to install a database plugin from an explicit local file path or HTTPS URL the user must approve. Does NOT download, install, or enable anything by itself.',
      parameters: {
        type: 'object',
        properties: {
          source_kind: { type: 'string', enum: ['file', 'url'], description: 'Whether the location is a local file path or an HTTPS URL.' },
          location: { type: 'string', description: 'The explicit file path or HTTPS URL of the .gatesdb package.' },
          reason: { type: 'string', description: 'Why this plugin is relevant to the task.' },
        },
        required: ['source_kind', 'location'],
        additionalProperties: false,
      },
    },
    meta: {
      category: 'knowledge', capabilityId: 'catalog.read', risk: 'medium',
      isReadOnly: () => true, hasSideEffects: () => false, resultPolicy: RESULT_POLICY,
      validate: validateProposeArgs,
    },
    async execute(args) {
      const sourceKind = args.source_kind === 'url' ? 'url' : 'file'
      const location = String(args.location)
      return success('database_plugins_propose_install', 'Created an install proposal for user approval. No download or install has occurred.', {
        proposal: {
          kind: 'database_plugin_install',
          source: { kind: sourceKind, location },
          reason: typeof args.reason === 'string' ? args.reason.slice(0, 1_000) : undefined,
          requires_user_approval: true,
          performed: false,
        },
      })
    },
  }
}

// ---- validation & formatting ----------------------------------------------

function validateSearchArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  const idIssue = validatePluginId(args.plugin_id) ?? validateMemberId('dataset_id', args.dataset_id)
  if (idIssue) return idIssue
  if (args.search_id !== undefined) {
    const searchIssue = validateMemberId('search_id', args.search_id)
    if (searchIssue) return searchIssue
  }
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query || query.length > DATABASE_PLUGIN_BOUNDS.maxQueryLength) {
    return issue('invalid_query', `Search query must be 1 to ${DATABASE_PLUGIN_BOUNDS.maxQueryLength} characters.`)
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > DATABASE_PLUGIN_BOUNDS.maxResults)) {
    return issue('invalid_limit', `Limit must be an integer from 1 to ${DATABASE_PLUGIN_BOUNDS.maxResults}.`)
  }
  return null
}

function validateLookupArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  const idIssue = validatePluginId(args.plugin_id)
    ?? validateMemberId('dataset_id', args.dataset_id)
    ?? validateMemberId('lookup_id', args.lookup_id)
  if (idIssue) return idIssue
  if (args.parameters !== undefined && (typeof args.parameters !== 'object' || args.parameters === null || Array.isArray(args.parameters))) {
    return issue('invalid_parameters', 'parameters must be an object of scalar values.')
  }
  return null
}

function validateProposeArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  if (args.source_kind !== 'file' && args.source_kind !== 'url') {
    return issue('invalid_source_kind', 'source_kind must be "file" or "url".')
  }
  const location = typeof args.location === 'string' ? args.location.trim() : ''
  if (!location || location.length > 4_000) {
    return issue('invalid_location', 'location must be a non-empty path or URL under 4000 characters.')
  }
  if (args.source_kind === 'url' && !/^https:\/\//i.test(location)) {
    return issue('invalid_location', 'A url source must be an https:// URL.')
  }
  return null
}

function validatePluginId(value: unknown): ToolValidationIssue | null {
  if (typeof value !== 'string' || !PLUGIN_ID_PATTERN.test(value)) {
    return issue('invalid_plugin_id', 'plugin_id must be a reverse-DNS id such as com.example.people.')
  }
  return null
}

function validateMemberId(field: string, value: unknown): ToolValidationIssue | null {
  if (typeof value !== 'string' || !PLUGIN_MEMBER_ID_PATTERN.test(value)) {
    return issue(`invalid_${field}`, `${field} must match [a-z0-9][a-z0-9_-]{0,63}.`)
  }
  return null
}

function issue(errorCode: string, summary: string): ToolValidationIssue {
  return { errorCode, summary, fix: 'Use the bounded values described by this read-only tool.', retryable: true }
}

function queryResult(tool: string, data: DatabasePluginQueryResponse): ToolExecuteResult {
  const summary = `Returned ${data.rows.length} cited row${data.rows.length === 1 ? '' : 's'}${data.truncated ? ' (truncated)' : ''}.`
  return success(tool, summary, data)
}

function success(tool: string, summary: string, data: unknown): ToolExecuteResult {
  return { ok: true, summary, content: `status: ok\ntool: ${tool}\nsummary: ${summary}\ndata: ${JSON.stringify(data)}`, data }
}

function failure(tool: string, error: DatabasePluginError): ToolExecuteResult {
  const retryable = error.kind === 'host_error' || error.kind === 'unknown'
  return {
    ok: false, errorCode: `database_plugins_${error.kind}`, retryable, summary: error.message,
    content: `status: error\ntool: ${tool}\nerror_code: database_plugins_${error.kind}\nsummary: ${error.message}\nretryable: ${retryable ? 'true' : 'false'}`,
  }
}

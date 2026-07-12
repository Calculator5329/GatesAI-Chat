import { describe, expect, it, vi } from 'vitest'

import type { OfflineLibraryKnowledgeArena } from '../../../src/core/offlineLibrary'
import type { OfflineLibraryFacade, ToolContext } from '../../../src/services/tools/types'
import {
  knowledgeBenchmarksTool,
  librarySearchTool,
  librarySourcesTool,
  publicDatabaseSchemaTool,
} from '../../../src/services/tools/offlineLibrary'
import { toolRegistry } from '../../../src/services/tools/registry'

function facade(overrides: Partial<OfflineLibraryFacade> = {}): OfflineLibraryFacade {
  return {
    available: true,
    documentProfile: null,
    search: vi.fn<OfflineLibraryFacade['search']>(async request => ({
      ok: true,
      data: {
        api_version: '1', query: request.query, mode: request.mode,
        matches: [
          { title: 'Pacman hooks', uri: 'kiwix://archlinux/pacman-hooks', excerpt: 'Hook details', source: 'Arch Wiki', retrieval: 'kiwix-native', score: 1 },
          { title: 'Manual', uri: 'man:pacman.8', excerpt: 'Manual details', source: 'man-pages', retrieval: 'fulltext', score: 0.5, content: 'not projected', local_url: 'http://127.0.0.1/private' },
        ],
      },
    })),
    getSources: vi.fn<OfflineLibraryFacade['getSources']>(async () => ({
      ok: true,
      data: { api_version: '1', sources: [{ name: 'arch-wiki', kind: 'kiwix-zim', license: 'CC BY-SA', version: null, enabled: true, document_count: 10, provenance: {} }] },
    })),
    getDatabases: vi.fn<OfflineLibraryFacade['getDatabases']>(async () => ({
      ok: true,
      data: { api_version: '1', databases: [{ alias: 'public-docs', description: 'Public docs', sensitivity: 'public', enabled: true, available: true, access: 'read_only' }], query_endpoint_available: false },
    })),
    getPublicSchema: vi.fn<OfflineLibraryFacade['getPublicSchema']>(async alias => ({
      ok: true,
      data: { api_version: '1', database: { alias, description: 'Public docs', sensitivity: 'public', health: 'ok', objects: [{ name: 'pages', type: 'table' }] }, query_endpoint_available: false },
    })),
    getProfiles: vi.fn<OfflineLibraryFacade['getProfiles']>(async () => ({
      ok: true,
      data: { schema_version: 1, plugin_version: '1.3.0', source_run: 'repeat', source_run_trials: 9, source_run_cells: 3, local_only: true, remote_fallback: false, selection: {}, profiles: [] },
    })),
    getKnowledgeArena: vi.fn<OfflineLibraryFacade['getKnowledgeArena']>(async () => ({
      ok: true,
      data: { api_version: '1', available: true, run: { trials: 9 }, summaries: { model: [{ name: 'phi4' }] }, cells: [{ raw: 'excluded' }] } as unknown as OfflineLibraryKnowledgeArena,
    })),
    ...overrides,
  }
}

function context(library: OfflineLibraryFacade): ToolContext {
  return { offlineLibrary: library, threadId: 'thread-1' } as ToolContext
}

describe('Offline Library model tools', () => {
  it('are honestly read-only and appear only while the addon is healthy', () => {
    for (const tool of [librarySearchTool, librarySourcesTool, publicDatabaseSchemaTool, knowledgeBenchmarksTool]) {
      expect(tool.meta?.isReadOnly?.({})).toBe(true)
      expect(tool.meta?.hasSideEffects?.({})).toBe(false)
      expect(tool.meta?.category).toBe('knowledge')
    }
    const without = toolRegistry.toolDefsForTurn({ userText: 'search my books', bridgeOnline: false })
    expect(without.some(tool => tool.name === 'library_search')).toBe(false)
    const withAddon = toolRegistry.toolDefsForTurn({ userText: 'search my books', bridgeOnline: false, offlineLibraryAvailable: true })
    expect(withAddon.filter(tool => tool.name.startsWith('library_') || tool.name === 'public_database_schema' || tool.name === 'knowledge_benchmarks')).toHaveLength(4)
  })

  it('bounds inputs before any service call', () => {
    expect(toolRegistry.validateCallDetailed('library_search', { query: 'hooks', limit: 11 }).errorCode).toBe('invalid_limit')
    expect(toolRegistry.validateCallDetailed('public_database_schema', { alias: '../private' }).errorCode).toBe('invalid_public_alias')
  })

  it('preserves citation URIs exactly and excludes host-only fields', async () => {
    const result = await toolRegistry.execute('library_search', { query: 'pacman hooks', limit: 2, mode: 'hybrid', include_kiwix: true }, context(facade()))
    expect(result.ok).toBe(true)
    expect(result.content).toContain('kiwix://archlinux/pacman-hooks')
    expect(result.content).toContain('man:pacman.8')
    expect(result.content).not.toContain('local_url')
    expect(result.content).not.toContain('not projected')
    const persisted = JSON.parse(JSON.stringify({ toolResults: [{ content: result.content }] }))
    expect(persisted.toolResults[0].content).toContain('kiwix://archlinux/pacman-hooks')
  })

  it('applies the visible local profile retrieval override and reports its evidence', async () => {
    const library = facade({
      documentProfile: {
        id: 'library-quality', label: 'Offline documents — quality', task_kind: 'knowledge_document', model: 'phi4',
        retrieval: { strategy: 'hybrid-native', mode: 'hybrid', include_kiwix: true },
        evidence: { trials: 84, average_score: 86.39, score_confidence_95: { low: 83.52, high: 89.27 }, source_hit_rate: 1, expected_term_recall: 0.9762, citation_validity_rate: 0.4881, average_retrieval_latency_ms: 699.25, average_generation_latency_ms: 5390.18, error_count: 0 },
        limitations: ['Evidence-backed suggestion; user override remains available.'],
      },
    })
    const result = await toolRegistry.execute('library_search', { query: 'pacman', mode: 'fulltext', include_kiwix: false }, context(library))
    expect(library.search).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hybrid', includeKiwix: true }))
    expect(result.content).toContain('library-quality')
    expect(result.content).toContain('"model_suggestion":"phi4"')
    expect(result.content).toContain('"user_override_available":true')
  })

  it('returns public inventory and schema metadata without row access', async () => {
    const library = facade()
    const inventory = await toolRegistry.execute('library_sources', {}, context(library))
    expect(inventory.content).toContain('public-docs')
    expect(inventory.content).toContain('"database_rows_available":false')
    const schema = await toolRegistry.execute('public_database_schema', { alias: 'public-docs' }, context(library))
    expect(schema.content).toContain('"query_endpoint_available":false')
    expect(schema.content).not.toContain('/home/')
  })

  it('labels trust proxies honestly and excludes exact benchmark cells', async () => {
    const result = await toolRegistry.execute('knowledge_benchmarks', { view: 'summary' }, context(facade()))
    expect(result.content).toContain('not factual hallucination judgments')
    expect(result.content).not.toContain('"cells"')
    expect(result.content).not.toContain('"raw"')
  })

  it('fails closed when the addon is disabled or unhealthy', async () => {
    const library = facade({ available: false })
    const result = await toolRegistry.execute('library_sources', {}, context(library))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('offline_library_unavailable')
    expect(library.getSources).not.toHaveBeenCalled()
  })
})

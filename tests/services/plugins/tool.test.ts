import { describe, expect, it } from 'vitest'
import { createDatabasePluginTools, type DatabasePluginToolFacade } from '../../../src/services/plugins/tool'
import type { Tool, ToolExecuteResult } from '../../../src/services/tools/types'
import type { InstalledDatabasePlugin } from '../../../src/services/plugins/types'
import { buildPackage } from './fixtures'

function installedRecord(): InstalledDatabasePlugin {
  const pkg = buildPackage()
  return {
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    manifest: pkg.manifest,
    enabled: true,
    installedAt: 0,
    source: pkg.source,
    effectiveDataPolicy: 'local_only',
  }
}

function facadeWith(overrides: Partial<DatabasePluginToolFacade> = {}): DatabasePluginToolFacade {
  return {
    route: () => ({ isLocal: true }),
    list: async () => ({ ok: true, data: [installedRecord()] }),
    search: async () => ({
      ok: true,
      data: { pluginId: 'com.example.people', version: '1.0.0', datasetId: 'people', truncated: false, rows: [{ recordId: 'p1', citation: 'gatesdb://com.example.people@1.0.0/people/p1', fields: { name: 'Ada' } }] },
    }),
    lookup: async () => ({ ok: false, error: { kind: 'disabled', message: 'plugin disabled' } }),
    ...overrides,
  }
}

function byName(tools: Tool[], name: string): Tool {
  const tool = tools.find(t => t.def.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool
}

async function run(tool: Tool, args: Record<string, unknown>): Promise<ToolExecuteResult> {
  const result = await tool.execute(args, {} as never)
  if (typeof result === 'string') throw new Error('expected structured result')
  return result as ToolExecuteResult
}

describe('database plugin tool facade', () => {
  it('exposes exactly the five bounded operations, all read-only metadata', () => {
    const tools = createDatabasePluginTools(facadeWith())
    expect(tools.map(t => t.def.name).sort()).toEqual([
      'database_plugins_list',
      'database_plugins_lookup',
      'database_plugins_propose_install',
      'database_plugins_schema',
      'database_plugins_search',
    ])
    for (const tool of tools) {
      expect(tool.meta?.isReadOnly?.({})).toBe(true)
      expect(tool.meta?.hasSideEffects?.({})).toBe(false)
    }
  })

  it('lists installed plugins as metadata only', async () => {
    const tools = createDatabasePluginTools(facadeWith())
    const result = await run(byName(tools, 'database_plugins_list'), {})
    expect(result.ok).toBe(true)
    const data = result.data as { plugins: Array<{ id: string; data_policy: string }> }
    expect(data.plugins[0]).toMatchObject({ id: 'com.example.people', data_policy: 'local_only' })
  })

  it('returns cited rows on search and surfaces typed failures', async () => {
    const tools = createDatabasePluginTools(facadeWith())
    const ok = await run(byName(tools, 'database_plugins_search'), { plugin_id: 'com.example.people', dataset_id: 'people', query: 'ada' })
    expect(ok.ok).toBe(true)
    expect(ok.content).toContain('gatesdb://com.example.people@1.0.0/people/p1')

    const failed = await run(byName(tools, 'database_plugins_lookup'), { plugin_id: 'com.example.people', dataset_id: 'people', lookup_id: 'by_id', parameters: { id: 'p1' } })
    expect(failed.ok).toBe(false)
    expect(failed.errorCode).toBe('database_plugins_disabled')
  })

  it('validates bounded arguments', () => {
    const tools = createDatabasePluginTools(facadeWith())
    const search = byName(tools, 'database_plugins_search')
    expect(search.meta?.validate?.({ plugin_id: 'com.example.people', dataset_id: 'people', query: '' })?.errorCode).toBe('invalid_query')
    expect(search.meta?.validate?.({ plugin_id: 'BAD ID', dataset_id: 'people', query: 'x' })?.errorCode).toBe('invalid_plugin_id')
    expect(search.meta?.validate?.({ plugin_id: 'com.example.people', dataset_id: 'people', query: 'x', limit: 999 })?.errorCode).toBe('invalid_limit')
    expect(search.meta?.validate?.({ plugin_id: 'com.example.people', dataset_id: 'people', query: 'x' })).toBeNull()
  })

  it('propose_install only creates a proposal, never performing an install', async () => {
    const tools = createDatabasePluginTools(facadeWith())
    const result = await run(byName(tools, 'database_plugins_propose_install'), { source_kind: 'url', location: 'https://example.com/x.gatesdb', reason: 'relevant' })
    expect(result.ok).toBe(true)
    const data = result.data as { proposal: { performed: boolean; requires_user_approval: boolean } }
    expect(data.proposal.performed).toBe(false)
    expect(data.proposal.requires_user_approval).toBe(true)

    const propose = byName(tools, 'database_plugins_propose_install')
    expect(propose.meta?.validate?.({ source_kind: 'url', location: 'http://insecure' })?.errorCode).toBe('invalid_location')
  })
})

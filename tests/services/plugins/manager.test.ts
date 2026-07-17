import { beforeEach, describe, expect, it } from 'vitest'
import { DatabasePluginManager } from '../../../src/services/plugins/manager'
import type { RouteDescriptor } from '../../../src/services/plugins/policy'
import { FakePluginHost, buildPackage } from './fixtures'

const LOCAL: RouteDescriptor = { isLocal: true }
const CLOUD: RouteDescriptor = { isLocal: false, modelId: 'cloud-model' }

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: { kind: string; message: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.kind}: ${result.error.message}`)
  return result.data
}

function errKind(result: { ok: boolean; error?: { kind: string } }): string {
  if (result.ok) throw new Error('expected failure')
  return result.error!.kind
}

describe('DatabasePluginManager lifecycle', () => {
  let host: FakePluginHost
  let manager: DatabasePluginManager

  beforeEach(() => {
    host = new FakePluginHost()
    manager = new DatabasePluginManager({ host, hostVersion: '4.6.1', now: () => 1_000 })
  })

  it('installs a valid package (disabled + local-only by default) and lists it', async () => {
    const installed = unwrap(await manager.install(buildPackage()))
    expect(installed.enabled).toBe(false)
    expect(installed.effectiveDataPolicy).toBe('local_only')
    expect(installed.installedAt).toBe(1_000)
    expect(host.installFiles).toHaveLength(1)
    const listed = unwrap(await manager.list())
    expect(listed.map(p => p.id)).toEqual(['com.example.people'])
  })

  it('installs enabled when requested', async () => {
    const installed = unwrap(await manager.install(buildPackage(), { enable: true }))
    expect(installed.enabled).toBe(true)
  })

  it('honors the data-policy ceiling: cloud only when the bundle allows it and the user opts in', async () => {
    const cloudBundle = buildPackage({ id: 'com.example.cloud', dataPolicy: 'cloud_allowed' })
    expect(unwrap(await manager.install(cloudBundle, { allowCloud: true })).effectiveDataPolicy).toBe('cloud_allowed')

    host.installed = []
    expect(unwrap(await manager.install(cloudBundle)).effectiveDataPolicy).toBe('local_only')

    host.installed = []
    // A local_only bundle can never be loosened, even if the user asks.
    expect(unwrap(await manager.install(buildPackage(), { allowCloud: true })).effectiveDataPolicy).toBe('local_only')
  })

  it('fails closed on a tampered package and writes nothing', async () => {
    const pkg = buildPackage()
    pkg.files[0].bytes = new TextEncoder().encode('tampered')
    expect(errKind(await manager.install(pkg))).toBe('integrity_mismatch')
    expect(host.installed).toHaveLength(0)
  })

  it('rejects an incompatible host version', async () => {
    expect(errKind(await manager.install(buildPackage({ minHostVersion: '99.0.0' })))).toBe('incompatible_host')
  })

  it('removes and toggles enablement', async () => {
    await manager.install(buildPackage())
    expect((await manager.setEnabled('com.example.people', true)).ok).toBe(true)
    expect(unwrap(await manager.get('com.example.people')).enabled).toBe(true)
    expect((await manager.remove('com.example.people')).ok).toBe(true)
    expect(unwrap(await manager.list())).toHaveLength(0)
  })

  it('reports web_lite for install/query and an empty list when the host is unavailable', async () => {
    host.available = false
    expect(errKind(await manager.install(buildPackage()))).toBe('web_lite')
    expect(unwrap(await manager.list())).toEqual([])
    expect(errKind(await manager.search({ pluginId: 'x', datasetId: 'people', query: 'a' }, LOCAL))).toBe('web_lite')
  })
})

describe('DatabasePluginManager queries + policy ceilings', () => {
  let host: FakePluginHost
  let manager: DatabasePluginManager

  async function installEnabled(options?: Parameters<typeof buildPackage>[0], allowCloud?: boolean) {
    return manager.install(buildPackage(options), { enable: true, allowCloud })
  }

  beforeEach(() => {
    host = new FakePluginHost()
    manager = new DatabasePluginManager({ host, hostVersion: '4.6.1' })
  })

  it('returns capped, cited evidence rows for a search on a local route', async () => {
    await installEnabled()
    host.searchRows = [
      { recordId: 'p1', fields: { name: 'Ada' } },
      { recordId: 'p2', fields: { name: 'Alan' } },
    ]
    const response = unwrap(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'a' }, LOCAL))
    expect(response.rows.map(r => r.citation)).toEqual([
      'gatesdb://com.example.people@1.0.0/people/p1',
      'gatesdb://com.example.people@1.0.0/people/p2',
    ])
    expect(response.truncated).toBe(false)
    expect(host.searchCalls[0]).toMatchObject({ datasetPath: 'data/people.sqlite', searchId: 'by_name', limit: 50 })
  })

  it('caps result rows at the host maximum and flags truncation', async () => {
    await installEnabled()
    host.searchRows = Array.from({ length: 60 }, (_, i) => ({ recordId: `p${i}`, fields: { i } }))
    const response = unwrap(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'a' }, LOCAL))
    expect(response.rows).toHaveLength(50)
    expect(response.truncated).toBe(true)
  })

  it('caps by transcript characters', async () => {
    await installEnabled()
    const big = 'x'.repeat(5_000)
    host.searchRows = Array.from({ length: 20 }, (_, i) => ({ recordId: `p${i}`, fields: { blob: big } }))
    const response = unwrap(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'a' }, LOCAL))
    expect(response.truncated).toBe(true)
    expect(response.rows.length).toBeLessThan(20)
  })

  it('blocks a local_only bundle on a cloud route before any host call', async () => {
    await installEnabled()
    expect(errKind(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'a' }, CLOUD)))
      .toBe('data_policy_blocked')
    expect(host.searchCalls).toHaveLength(0)
  })

  it('allows a cloud_allowed bundle on a cloud route', async () => {
    await installEnabled({ id: 'com.example.cloud', dataPolicy: 'cloud_allowed' }, true)
    host.searchRows = [{ recordId: 'p1', fields: { name: 'Ada' } }]
    const response = unwrap(await manager.search({ pluginId: 'com.example.cloud', datasetId: 'people', query: 'a' }, CLOUD))
    expect(response.rows).toHaveLength(1)
  })

  it('denies queries when the plugin is disabled or lacks the capability', async () => {
    await manager.install(buildPackage()) // installed but disabled
    expect(errKind(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'a' }, LOCAL)))
      .toBe('disabled')

    await manager.install(buildPackage({ id: 'com.example.nosearch', capabilities: ['catalog.read', 'schema.read', 'lookup.read'] }))
    await manager.setEnabled('com.example.nosearch', true)
    expect(errKind(await manager.search({ pluginId: 'com.example.nosearch', datasetId: 'people', query: 'a' }, LOCAL)))
      .toBe('capability_denied')
  })

  it('rejects an empty or overlong search query', async () => {
    await installEnabled()
    expect(errKind(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: '   ' }, LOCAL)))
      .toBe('invalid_request')
    expect(errKind(await manager.search({ pluginId: 'com.example.people', datasetId: 'people', query: 'x'.repeat(3_000) }, LOCAL)))
      .toBe('invalid_request')
  })

  it('runs a typed lookup and enforces its parameter contract', async () => {
    await installEnabled()
    host.lookupRows = [{ recordId: 'p1', fields: { name: 'Ada', role: 'engineer' } }]
    const response = unwrap(await manager.lookup(
      { pluginId: 'com.example.people', datasetId: 'people', lookupId: 'by_id', parameters: { id: 'p1' } },
      LOCAL,
    ))
    expect(response.rows[0].citation).toBe('gatesdb://com.example.people@1.0.0/people/p1')
    expect(host.lookupCalls[0].parameters).toEqual({ id: 'p1' })

    expect(errKind(await manager.lookup(
      { pluginId: 'com.example.people', datasetId: 'people', lookupId: 'by_id', parameters: {} }, LOCAL,
    ))).toBe('invalid_request') // missing required

    expect(errKind(await manager.lookup(
      { pluginId: 'com.example.people', datasetId: 'people', lookupId: 'by_id', parameters: { id: 5 } as never }, LOCAL,
    ))).toBe('invalid_request') // wrong type

    expect(errKind(await manager.lookup(
      { pluginId: 'com.example.people', datasetId: 'people', lookupId: 'by_id', parameters: { id: 'p1', extra: 'x' } }, LOCAL,
    ))).toBe('invalid_request') // unknown parameter

    expect(errKind(await manager.lookup(
      { pluginId: 'com.example.people', datasetId: 'people', lookupId: 'missing', parameters: {} }, LOCAL,
    ))).toBe('invalid_request') // unknown lookup
  })
})

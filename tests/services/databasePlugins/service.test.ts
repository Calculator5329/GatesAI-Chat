import { describe, expect, it, vi } from 'vitest'

import { createDatabasePluginService, findDatabasePluginProjection, projectDatabasePluginCitation, versionPin } from '../../../src/services/databasePlugins'
import { validDatabasePluginManifest } from '../../support/databasePluginManifest'

describe('database plugin service', () => {
  it('never invokes a bridge in Web Lite', async () => {
    const bridge = { listInstalled: vi.fn(async () => [validDatabasePluginManifest()]) }
    const result = await createDatabasePluginService({ runtime: 'web-lite', bridge }).listInstalled()
    expect(result).toEqual({ ok: false, error: { kind: 'desktop_only', message: expect.any(String) } })
    expect(bridge.listInstalled).not.toHaveBeenCalled()
  })

  it('parses installed manifests and fails closed on duplicate active versions', async () => {
    const manifest = validDatabasePluginManifest()
    const service = createDatabasePluginService({ runtime: 'desktop', bridge: { listInstalled: async () => [manifest] } })
    const result = await service.listInstalled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(versionPin(result.data[0])).toMatchObject({ id: manifest.id, version: manifest.version, dataPolicy: 'local_only' })

    const duplicate = await createDatabasePluginService({ runtime: 'desktop', bridge: { listInstalled: async () => [manifest, manifest] } }).listInstalled()
    expect(duplicate).toMatchObject({ ok: false, error: { kind: 'invalid_manifest' } })
  })

  it('distinguishes an unavailable engine from invalid installed metadata', async () => {
    const result = await createDatabasePluginService({
      runtime: 'desktop',
      bridge: { listInstalled: async () => { throw new Error('engine offline') } },
    }).listInstalled()
    expect(result).toEqual({ ok: false, error: { kind: 'unavailable', message: 'engine offline' } })
  })

  it('projects only declared lookups/searches and creates versioned local citations', () => {
    const manifest = validDatabasePluginManifest()
    expect(findDatabasePluginProjection(manifest, 'places', 'by_id')?.kind).toBe('lookup')
    expect(findDatabasePluginProjection(manifest, 'places', 'missing')).toBeNull()
    expect(projectDatabasePluginCitation({
      pluginId: manifest.id,
      pluginVersion: manifest.version,
      namespace: manifest.citation_namespace,
      datasetId: 'places',
      recordId: 'record/1',
    }).uri).toBe('gatesdb://demo/places/record%2F1?plugin=demo.db&version=1.0.0')
  })
})

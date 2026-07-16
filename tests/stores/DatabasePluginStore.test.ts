import { describe, expect, it, vi } from 'vitest'

import type { DatabasePluginService } from '../../src/services/databasePlugins'
import type { DatabasePluginSettingsSnapshot } from '../../src/services/databasePlugins/persistence'
import type { DatabasePluginSettingsPersistence } from '../../src/services/databasePlugins/persistence'
import { DatabasePluginStore } from '../../src/stores/DatabasePluginStore'
import { validDatabasePluginManifest } from '../support/databasePluginManifest'

function setup(options: { runtime?: 'desktop' | 'web-lite'; savedVersion?: string } = {}) {
  const manifest = validDatabasePluginManifest()
  let snapshot: DatabasePluginSettingsSnapshot = {
    version: 1,
    plugins: options.savedVersion ? [{ id: manifest.id, version: options.savedVersion, enabled: true }] : [],
  }
  const persistence: DatabasePluginSettingsPersistence = {
    load: () => snapshot,
    save: vi.fn(value => { snapshot = value; return true }),
    clear: vi.fn(() => true),
  }
  const service: DatabasePluginService = {
    listInstalled: vi.fn(async () => ({ ok: true as const, data: [manifest] })),
  }
  const store = new DatabasePluginStore({ runtime: options.runtime ?? 'desktop', service, persistence })
  return { store, service, persistence, manifest }
}

describe('DatabasePluginStore', () => {
  it('refreshes typed manifests, persists enablement, and exposes an exact version pin', async () => {
    const { store, persistence, manifest } = setup()
    await store.initialize()
    expect(store.phase).toBe('ready')
    expect(store.setEnabled(manifest.id, true)).toBe(true)
    expect(store.pinFor(manifest.id)).toMatchObject({ id: manifest.id, version: manifest.version, dataPolicy: 'local_only' })
    expect(persistence.save).toHaveBeenCalledWith({ version: 1, plugins: [{ id: manifest.id, version: manifest.version, enabled: true }] })
  })

  it('does not silently carry enablement across a version change', async () => {
    const { store, manifest } = setup({ savedVersion: '0.9.0' })
    await store.initialize()
    expect(store.find(manifest.id)).toMatchObject({ enabled: false, persistedVersionMismatch: true })
    expect(store.setEnabled(manifest.id, true)).toBe(false)
    expect(store.acceptInstalledVersion(manifest.id)).toBe(true)
    expect(store.setEnabled(manifest.id, true)).toBe(true)
  })

  it('never invokes the service or enables plugins in Web Lite', async () => {
    const { store, service, manifest } = setup({ runtime: 'web-lite', savedVersion: '1.0.0' })
    await store.initialize()
    expect(store.phase).toBe('web_lite')
    expect(store.setEnabled(manifest.id, true)).toBe(false)
    expect(service.listInstalled).not.toHaveBeenCalled()
  })

  it('revokes enabled pins while an installed-version revalidation is pending', async () => {
    const { store, service, manifest } = setup()
    await store.refresh()
    expect(store.setEnabled(manifest.id, true)).toBe(true)
    let resolveRefresh: ((value: Awaited<ReturnType<DatabasePluginService['listInstalled']>>) => void) | undefined
    vi.mocked(service.listInstalled).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve }))
    const refresh = store.refresh()
    expect(store.phase).toBe('checking')
    expect(store.enabled).toEqual([])
    expect(store.pinFor(manifest.id)).toBeNull()
    resolveRefresh?.({ ok: true, data: [manifest] })
    await refresh
  })

  it('does not grant enablement when the durable receipt fails', async () => {
    const { store, persistence, manifest } = setup()
    await store.refresh()
    vi.mocked(persistence.save).mockReturnValueOnce(false)
    expect(store.setEnabled(manifest.id, true)).toBe(false)
    expect(store.find(manifest.id)?.enabled).toBe(false)
    expect(store.pinFor(manifest.id)).toBeNull()
  })

  it('reports discovery failure without retaining stale authority', async () => {
    const { store, service, manifest } = setup()
    await store.refresh()
    expect(store.setEnabled(manifest.id, true)).toBe(true)
    vi.mocked(service.listInstalled).mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', message: 'engine offline' } })
    await store.refresh()
    expect(store.phase).toBe('error')
    expect(store.enabled).toEqual([])
    expect(store.error).toBe('engine offline')
  })
})

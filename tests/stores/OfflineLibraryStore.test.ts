import { describe, expect, it, vi } from 'vitest'

import type { OfflineLibraryKnowledgeArena, OfflineLibraryPluginManifest, OfflineLibraryProfiles, OfflineLibraryStatus } from '../../src/core/offlineLibrary'
import type { OfflineLibraryService } from '../../src/services/offlineLibrary'
import type { PersistenceProvider } from '../../src/services/storage/persistenceProvider'
import type { OfflineLibrarySettingsSnapshot } from '../../src/services/storage/offlineLibraryStorage'
import { OfflineLibraryStore } from '../../src/stores/OfflineLibraryStore'
import pluginFixture from '../fixtures/offline-library/v1.3/plugin.json'
import profilesFixture from '../fixtures/offline-library/v1.3/profiles.json'
import knowledgeArenaFixture from '../fixtures/offline-library/v1.3/knowledge-arena.json'

const plugin = pluginFixture as OfflineLibraryPluginManifest
const status = { api_version: '1', generated_at: 'now', library: {}, services: {}, catalog: {}, collections: [] } satisfies OfflineLibraryStatus
const profiles = profilesFixture as OfflineLibraryProfiles
const knowledgeArena = knowledgeArenaFixture as OfflineLibraryKnowledgeArena

function setup(options: { saved?: boolean; runtime?: 'desktop' | 'web-lite' } = {}) {
  let snapshot: OfflineLibrarySettingsSnapshot = { version: 1, enabled: options.saved ?? false, profileOverrideId: null }
  const persistence: PersistenceProvider<OfflineLibrarySettingsSnapshot> = {
    load: () => snapshot,
    save: vi.fn(value => { snapshot = value }),
    clear: vi.fn(),
  }
  const service = {
    getPlugin: vi.fn<OfflineLibraryService['getPlugin']>(async () => ({ ok: true, data: plugin })),
    getStatus: vi.fn<OfflineLibraryService['getStatus']>(async () => ({ ok: true, data: status })),
    getProfiles: vi.fn<OfflineLibraryService['getProfiles']>(async () => ({ ok: true, data: profiles })),
    getSources: vi.fn<OfflineLibraryService['getSources']>(async () => ({
      ok: true,
      data: { api_version: '1', sources: [{ name: 'arch-wiki', kind: 'kiwix', license: 'CC BY-SA', version: null, enabled: true, document_count: 10, provenance: {} }] },
    })),
    getKnowledgeArena: vi.fn<OfflineLibraryService['getKnowledgeArena']>(async () => ({ ok: true, data: knowledgeArena })),
  }
  const store = new OfflineLibraryStore({
    runtime: options.runtime ?? 'desktop', service, persistence,
  })
  return { store, service, persistence }
}

describe('OfflineLibraryStore', () => {
  it('starts disabled and performs no discovery until explicitly enabled', () => {
    const { store, service } = setup()
    expect(store.phase).toBe('disabled')
    expect(service.getPlugin).not.toHaveBeenCalled()
  })

  it('persists enablement, validates the manifest, and exposes read permissions', async () => {
    const { store, service, persistence } = setup()
    await store.setEnabled(true)
    expect(persistence.save).toHaveBeenCalledWith({ version: 1, enabled: true, profileOverrideId: null })
    expect(service.getPlugin).toHaveBeenCalledTimes(1)
    expect(service.getStatus).toHaveBeenCalledTimes(1)
    expect(store.phase).toBe('healthy')
    expect(store.declaredPermissions).toContain('search.read')
    expect(store.declaredPermissions).not.toContain('mutations')
    expect(store.profileForTask('public_database_schema')?.model).toBe('qwen2.5-coder:14b')
    expect(store.profileForTask('knowledge_document')?.model).toBe('phi4')
    expect(store.sources?.sources).toHaveLength(1)
    expect(store.knowledgeArena?.available).toBe(true)
  })

  it('keeps the addon healthy when optional benchmark details are unavailable', async () => {
    const { store, service } = setup()
    service.getKnowledgeArena.mockResolvedValueOnce({
      ok: false, error: { kind: 'unavailable', message: 'benchmark host busy' },
    })
    await store.setEnabled(true)
    expect(store.phase).toBe('healthy')
    expect(store.knowledgeArena).toBeNull()
    expect(store.detailsError).toBe('benchmark host busy')
  })

  it('supports an explicit persisted profile override without a remote fallback', async () => {
    const { store, persistence } = setup()
    await store.setEnabled(true)
    store.setProfileOverride('library-balanced')
    expect(store.profileForTask('public_database_schema')?.id).toBe('library-balanced')
    expect(store.profileForTask('knowledge_document')?.id).toBe('library-balanced')
    expect(store.profiles?.local_only).toBe(true)
    expect(store.profiles?.remote_fallback).toBe(false)
    expect(persistence.save).toHaveBeenLastCalledWith({
      version: 1, enabled: true, profileOverrideId: 'library-balanced',
    })
    store.setProfileOverride(null)
    expect(store.profileForTask('knowledge_document')?.id).toBe('library-quality')
  })

  it('rehydrates enabled state and reports offline or incompatible distinctly', async () => {
    const offline = setup({ saved: true })
    offline.service.getPlugin.mockResolvedValueOnce({
      ok: false, error: { kind: 'unavailable', message: 'host down' },
    })
    await offline.store.initialize()
    expect(offline.store.phase).toBe('offline')

    const incompatible = setup({ saved: true })
    incompatible.service.getPlugin.mockResolvedValueOnce({
      ok: false, error: { kind: 'incompatible', message: 'wrong major' },
    })
    await incompatible.store.initialize()
    expect(incompatible.store.phase).toBe('incompatible')
  })

  it('never enables or invokes transport in Web Lite', async () => {
    const { store, service } = setup({ saved: true, runtime: 'web-lite' })
    expect(store.phase).toBe('web_lite')
    expect(store.enabled).toBe(false)
    await store.setEnabled(true)
    await store.initialize()
    expect(store.enabled).toBe(false)
    expect(service.getPlugin).not.toHaveBeenCalled()
  })

  it('ignores an in-flight discovery result after disable', async () => {
    let resolvePlugin: ((value: { ok: true; data: OfflineLibraryPluginManifest }) => void) | undefined
    const { store, service } = setup()
    service.getPlugin.mockImplementationOnce(() => new Promise(resolve => { resolvePlugin = resolve }))
    const enabling = store.setEnabled(true)
    await store.setEnabled(false)
    resolvePlugin?.({ ok: true, data: plugin })
    await enabling
    expect(store.phase).toBe('disabled')
    expect(service.getStatus).not.toHaveBeenCalled()
  })
})

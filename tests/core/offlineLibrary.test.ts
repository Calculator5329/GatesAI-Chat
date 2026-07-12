import { describe, expect, it } from 'vitest'

import {
  validateOfflineLibraryManifest,
  validateOfflineLibrarySearch,
} from '../../src/core/offlineLibrary'
import plugin from '../fixtures/offline-library/v1.3/plugin.json'

describe('Offline Library core contract', () => {
  it('accepts the pinned fixed-authority manifest', () => {
    expect(validateOfflineLibraryManifest(plugin).id).toBe('local.offline-library')
  })

  it('rejects changed authority and incompatible versions', () => {
    expect(() => validateOfflineLibraryManifest({ ...plugin, version: '2.0.0' })).toThrow('major')
    expect(() => validateOfflineLibraryManifest({
      ...plugin,
      transport: { ...plugin.transport, base_url: 'http://127.0.0.1:9999/api/v1' },
    })).toThrow('transport')
  })

  it('bounds search inputs', () => {
    expect(() => validateOfflineLibrarySearch({ query: 'pacman hooks', limit: 5, mode: 'hybrid', includeKiwix: true })).not.toThrow()
    expect(() => validateOfflineLibrarySearch({ query: ' ', limit: 5, mode: 'hybrid', includeKiwix: true })).toThrow('Query')
    expect(() => validateOfflineLibrarySearch({ query: 'ok', limit: 21, mode: 'hybrid', includeKiwix: true })).toThrow('limit')
  })
})

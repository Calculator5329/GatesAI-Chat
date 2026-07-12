import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_OFFLINE_LIBRARY_SETTINGS,
  offlineLibrarySettingsPersistence,
} from '../../../src/services/storage/offlineLibraryStorage'

describe('offlineLibrarySettingsPersistence', () => {
  beforeEach(() => localStorage.clear())

  it('defaults disabled and round-trips explicit enablement', () => {
    expect(offlineLibrarySettingsPersistence.load()).toEqual(DEFAULT_OFFLINE_LIBRARY_SETTINGS)
    offlineLibrarySettingsPersistence.save({ version: 1, enabled: true })
    expect(offlineLibrarySettingsPersistence.load()).toEqual({ version: 1, enabled: true })
  })

  it('falls back safely for malformed and future snapshots', () => {
    localStorage.setItem('gatesai.offlineLibrary.v1', JSON.stringify({ version: 2, enabled: true }))
    expect(offlineLibrarySettingsPersistence.load()).toEqual(DEFAULT_OFFLINE_LIBRARY_SETTINGS)
    localStorage.setItem('gatesai.offlineLibrary.v1', JSON.stringify({ version: 1, enabled: 'yes' }))
    expect(offlineLibrarySettingsPersistence.load()).toEqual(DEFAULT_OFFLINE_LIBRARY_SETTINGS)
  })
})

import { createJsonPersistenceProvider, type PersistenceProvider } from './persistenceProvider'

export const OFFLINE_LIBRARY_SETTINGS_VERSION = 1

export interface OfflineLibrarySettingsSnapshot {
  version: 1
  enabled: boolean
  profileOverrideId: string | null
}

export const DEFAULT_OFFLINE_LIBRARY_SETTINGS: OfflineLibrarySettingsSnapshot = {
  version: OFFLINE_LIBRARY_SETTINGS_VERSION,
  enabled: false,
  profileOverrideId: null,
}

export const offlineLibrarySettingsPersistence: PersistenceProvider<OfflineLibrarySettingsSnapshot> =
  createJsonPersistenceProvider({
    key: 'gatesai.offlineLibrary.v1',
    parse(raw) {
      if (!raw || typeof raw !== 'object') return { ...DEFAULT_OFFLINE_LIBRARY_SETTINGS }
      const value = raw as Partial<OfflineLibrarySettingsSnapshot>
      if (value.version !== OFFLINE_LIBRARY_SETTINGS_VERSION || typeof value.enabled !== 'boolean') {
        return { ...DEFAULT_OFFLINE_LIBRARY_SETTINGS }
      }
      const profileOverrideId = typeof value.profileOverrideId === 'string' && value.profileOverrideId.length <= 100
        ? value.profileOverrideId
        : null
      return { version: OFFLINE_LIBRARY_SETTINGS_VERSION, enabled: value.enabled, profileOverrideId }
    },
  })

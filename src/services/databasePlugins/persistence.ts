import { browserLocalStorage, type KeyValuePersistence } from '../storage/persistenceProvider'

export const DATABASE_PLUGIN_SETTINGS_VERSION = 1 as const
const MAX_PERSISTED_PLUGINS = 100
const ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface DatabasePluginEnablement {
  id: string
  version: string
  enabled: boolean
}

export interface DatabasePluginSettingsSnapshot {
  version: typeof DATABASE_PLUGIN_SETTINGS_VERSION
  plugins: DatabasePluginEnablement[]
}

export const DEFAULT_DATABASE_PLUGIN_SETTINGS: DatabasePluginSettingsSnapshot = {
  version: DATABASE_PLUGIN_SETTINGS_VERSION,
  plugins: [],
}

export function parseDatabasePluginSettings(raw: unknown): DatabasePluginSettingsSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cloneDefaults()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['version', 'plugins'].includes(key))
    || value.version !== DATABASE_PLUGIN_SETTINGS_VERSION || !Array.isArray(value.plugins)
    || value.plugins.length > MAX_PERSISTED_PLUGINS) return cloneDefaults()
  const seen = new Set<string>()
  const plugins: DatabasePluginEnablement[] = []
  for (const rawEntry of value.plugins) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return cloneDefaults()
    const entry = rawEntry as Record<string, unknown>
    if (Object.keys(entry).some(key => !['id', 'version', 'enabled'].includes(key))
      || typeof entry.id !== 'string' || !ID.test(entry.id)
      || typeof entry.version !== 'string' || !SEMVER.test(entry.version)
      || typeof entry.enabled !== 'boolean' || seen.has(entry.id)) return cloneDefaults()
    seen.add(entry.id)
    plugins.push({ id: entry.id, version: entry.version, enabled: entry.enabled })
  }
  return { version: DATABASE_PLUGIN_SETTINGS_VERSION, plugins }
}

export interface DatabasePluginSettingsPersistence {
  load(): DatabasePluginSettingsSnapshot
  save(value: DatabasePluginSettingsSnapshot): boolean
  clear(): boolean
}

export function createDatabasePluginSettingsPersistence(
  storage: KeyValuePersistence = browserLocalStorage(),
): DatabasePluginSettingsPersistence {
  const key = 'gatesai.databasePlugins.v1'
  return {
    load() {
      try {
        const raw = storage.getItem(key)
        return raw === null ? cloneDefaults() : parseDatabasePluginSettings(JSON.parse(raw))
      } catch {
        return cloneDefaults()
      }
    },
    save(value) {
      try {
        storage.setItem(key, JSON.stringify(value))
        return true
      } catch {
        return false
      }
    },
    clear() {
      try {
        storage.removeItem(key)
        return true
      } catch {
        return false
      }
    },
  }
}

export const databasePluginSettingsPersistence = createDatabasePluginSettingsPersistence()

function cloneDefaults(): DatabasePluginSettingsSnapshot {
  return { version: DATABASE_PLUGIN_SETTINGS_VERSION, plugins: [] }
}

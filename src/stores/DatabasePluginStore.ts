import { makeAutoObservable, runInAction } from 'mobx'

import type { DatabasePluginManifest } from '../core/databasePlugins'
import type { GatesRuntimeMode } from '../core/runtime'
import {
  createDatabasePluginService,
  type DatabasePluginService,
  type DatabasePluginVersionPin,
  versionPin,
} from '../services/databasePlugins'
import {
  databasePluginSettingsPersistence,
  type DatabasePluginSettingsPersistence,
  type DatabasePluginSettingsSnapshot,
} from '../services/databasePlugins/persistence'

export type DatabasePluginPhase = 'web_lite' | 'idle' | 'checking' | 'ready' | 'error'

export interface DatabasePluginRecord {
  manifest: DatabasePluginManifest
  enabled: boolean
  persistedVersionMismatch: boolean
}

export interface DatabasePluginStoreOptions {
  runtime: GatesRuntimeMode
  service?: DatabasePluginService
  persistence?: DatabasePluginSettingsPersistence
}

export class DatabasePluginStore {
  phase: DatabasePluginPhase
  plugins: DatabasePluginRecord[] = []
  error: string | null = null
  lastCheckedAt: number | null = null

  private readonly runtime: GatesRuntimeMode
  private readonly service: DatabasePluginService
  private readonly persistence: DatabasePluginSettingsPersistence
  private persisted: DatabasePluginSettingsSnapshot
  private requestGeneration = 0

  constructor(options: DatabasePluginStoreOptions) {
    this.runtime = options.runtime
    this.service = options.service ?? createDatabasePluginService({ runtime: options.runtime })
    this.persistence = options.persistence ?? databasePluginSettingsPersistence
    this.persisted = this.persistence.load()
    this.phase = options.runtime === 'web-lite' ? 'web_lite' : 'idle'
    makeAutoObservable<this, 'runtime' | 'service' | 'persistence' | 'persisted' | 'requestGeneration'>(this, {
      runtime: false,
      service: false,
      persistence: false,
      persisted: false,
      requestGeneration: false,
    }, { autoBind: true })
  }

  get available(): boolean {
    return this.runtime === 'desktop'
  }

  get enabled(): DatabasePluginRecord[] {
    return this.phase === 'ready' ? this.plugins.filter(plugin => plugin.enabled) : []
  }

  find(id: string): DatabasePluginRecord | null {
    return this.plugins.find(plugin => plugin.manifest.id === id) ?? null
  }

  pinFor(id: string): DatabasePluginVersionPin | null {
    if (this.phase !== 'ready') return null
    const plugin = this.find(id)
    return plugin?.enabled ? versionPin(plugin.manifest) : null
  }

  async initialize(): Promise<void> {
    if (this.available) await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.available) return
    const generation = ++this.requestGeneration
    this.phase = 'checking'
    this.plugins = []
    this.error = null
    const result = await this.service.listInstalled()
    if (generation !== this.requestGeneration) return
    if (!result.ok) {
      runInAction(() => {
        this.plugins = []
        this.phase = 'error'
        this.error = result.error.message
        this.lastCheckedAt = Date.now()
      })
      return
    }
    const savedById = new Map(this.persisted.plugins.map(entry => [entry.id, entry]))
    runInAction(() => {
      this.plugins = result.data.map(manifest => {
        const saved = savedById.get(manifest.id)
        const persistedVersionMismatch = saved !== undefined && saved.version !== manifest.version
        return {
          manifest,
          enabled: saved?.enabled === true && !persistedVersionMismatch,
          persistedVersionMismatch,
        }
      })
      this.phase = 'ready'
      this.error = null
      this.lastCheckedAt = Date.now()
    })
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.available || this.phase !== 'ready') return false
    const plugin = this.find(id)
    if (!plugin || plugin.persistedVersionMismatch) return false
    const next: DatabasePluginSettingsSnapshot = {
      version: 1,
      plugins: this.plugins.map(item => ({
        id: item.manifest.id,
        version: item.manifest.version,
        enabled: item.manifest.id === id ? enabled : item.enabled,
      })),
    }
    if (!this.persistence.save(next)) return false
    plugin.enabled = enabled
    this.persisted = next
    return true
  }

  acceptInstalledVersion(id: string): boolean {
    if (!this.available || this.phase !== 'ready') return false
    const plugin = this.find(id)
    if (!plugin || !plugin.persistedVersionMismatch) return false
    const next: DatabasePluginSettingsSnapshot = {
      version: 1,
      plugins: this.plugins.map(item => ({
        id: item.manifest.id,
        version: item.manifest.version,
        enabled: item.manifest.id === id ? false : item.enabled,
      })),
    }
    if (!this.persistence.save(next)) return false
    plugin.persistedVersionMismatch = false
    plugin.enabled = false
    this.persisted = next
    return true
  }

  dispose(): void {
    this.requestGeneration += 1
  }
}

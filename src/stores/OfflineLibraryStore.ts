import { makeAutoObservable, runInAction } from 'mobx'

import type {
  OfflineLibraryPluginManifest,
  OfflineLibraryResult,
  OfflineLibraryStatus,
} from '../core/offlineLibrary'
import type { GatesRuntimeMode } from '../core/runtime'
import {
  offlineLibrarySettingsPersistence,
  type OfflineLibrarySettingsSnapshot,
} from '../services/storage/offlineLibraryStorage'
import type { PersistenceProvider } from '../services/storage/persistenceProvider'
import {
  offlineLibraryService,
  type OfflineLibraryService,
} from '../services/offlineLibrary'

export type OfflineLibraryPhase =
  | 'web_lite'
  | 'disabled'
  | 'checking'
  | 'healthy'
  | 'offline'
  | 'incompatible'
  | 'error'

export interface OfflineLibraryStoreOptions {
  runtime: GatesRuntimeMode
  service?: Pick<OfflineLibraryService, 'getPlugin' | 'getStatus'>
  persistence?: PersistenceProvider<OfflineLibrarySettingsSnapshot>
}

export class OfflineLibraryStore {
  enabled: boolean
  phase: OfflineLibraryPhase
  manifest: OfflineLibraryPluginManifest | null = null
  status: OfflineLibraryStatus | null = null
  error: string | null = null
  lastCheckedAt: number | null = null

  private readonly runtime: GatesRuntimeMode
  private readonly service: Pick<OfflineLibraryService, 'getPlugin' | 'getStatus'>
  private readonly persistence: PersistenceProvider<OfflineLibrarySettingsSnapshot>
  private requestGeneration = 0

  constructor(options: OfflineLibraryStoreOptions) {
    this.runtime = options.runtime
    this.service = options.service ?? offlineLibraryService
    this.persistence = options.persistence ?? offlineLibrarySettingsPersistence
    const saved = this.persistence.load()
    this.enabled = this.runtime === 'desktop' && saved.enabled
    this.phase = this.runtime === 'web-lite' ? 'web_lite' : 'disabled'
    makeAutoObservable<this, 'runtime' | 'service' | 'persistence' | 'requestGeneration'>(this, {
      runtime: false,
      service: false,
      persistence: false,
      requestGeneration: false,
    }, { autoBind: true })
  }

  get available(): boolean {
    return this.runtime === 'desktop'
  }

  get declaredPermissions(): string[] {
    return this.manifest?.capabilities.filter(capability => (
      capability === 'health' || capability.endsWith('.read')
    )) ?? []
  }

  get statusLabel(): string {
    switch (this.phase) {
      case 'web_lite': return 'Desktop only'
      case 'disabled': return 'Disabled'
      case 'checking': return 'Checking local host…'
      case 'healthy': return `Connected · plugin ${this.manifest?.version ?? 'compatible'}`
      case 'offline': return 'Enabled · local host unavailable'
      case 'incompatible': return 'Enabled · incompatible plugin'
      case 'error': return 'Enabled · connection error'
    }
  }

  async initialize(): Promise<void> {
    if (this.enabled) await this.refresh()
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.available) return
    this.requestGeneration += 1
    this.enabled = enabled
    this.persistence.save({ version: 1, enabled })
    if (!enabled) {
      this.phase = 'disabled'
      this.manifest = null
      this.status = null
      this.error = null
      return
    }
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.available || !this.enabled) return
    const generation = ++this.requestGeneration
    this.phase = 'checking'
    this.error = null
    const plugin = await this.service.getPlugin()
    if (!this.isCurrent(generation)) return
    if (!plugin.ok) {
      this.applyFailure(plugin)
      return
    }
    runInAction(() => { this.manifest = plugin.data })
    const status = await this.service.getStatus()
    if (!this.isCurrent(generation)) return
    if (!status.ok) {
      this.applyFailure(status)
      return
    }
    runInAction(() => {
      this.status = status.data
      this.phase = 'healthy'
      this.error = null
      this.lastCheckedAt = Date.now()
    })
  }

  dispose(): void {
    this.requestGeneration += 1
  }

  private isCurrent(generation: number): boolean {
    return generation === this.requestGeneration && this.enabled
  }

  private applyFailure(result: Extract<OfflineLibraryResult<unknown>, { ok: false }>): void {
    const { error } = result
    this.status = null
    this.error = error.message
    this.lastCheckedAt = Date.now()
    if (error.kind === 'incompatible') this.phase = 'incompatible'
    else if (error.kind === 'unavailable' || error.kind === 'timeout') this.phase = 'offline'
    else this.phase = 'error'
  }
}

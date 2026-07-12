import { makeAutoObservable, runInAction } from 'mobx'

import type {
  OfflineLibraryPluginManifest,
  OfflineLibraryProfile,
  OfflineLibraryProfiles,
  OfflineLibraryResult,
  OfflineLibraryKnowledgeArena,
  OfflineLibrarySources,
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
  service?: Pick<OfflineLibraryService, 'getPlugin' | 'getStatus' | 'getProfiles' | 'getSources' | 'getKnowledgeArena'>
  persistence?: PersistenceProvider<OfflineLibrarySettingsSnapshot>
}

export class OfflineLibraryStore {
  enabled: boolean
  phase: OfflineLibraryPhase
  manifest: OfflineLibraryPluginManifest | null = null
  status: OfflineLibraryStatus | null = null
  error: string | null = null
  lastCheckedAt: number | null = null
  profiles: OfflineLibraryProfiles | null = null
  sources: OfflineLibrarySources | null = null
  knowledgeArena: OfflineLibraryKnowledgeArena | null = null
  detailsError: string | null = null
  profileOverrideId: string | null

  private readonly runtime: GatesRuntimeMode
  private readonly service: Pick<OfflineLibraryService, 'getPlugin' | 'getStatus' | 'getProfiles' | 'getSources' | 'getKnowledgeArena'>
  private readonly persistence: PersistenceProvider<OfflineLibrarySettingsSnapshot>
  private requestGeneration = 0

  constructor(options: OfflineLibraryStoreOptions) {
    this.runtime = options.runtime
    this.service = options.service ?? offlineLibraryService
    this.persistence = options.persistence ?? offlineLibrarySettingsPersistence
    const saved = this.persistence.load()
    this.enabled = this.runtime === 'desktop' && saved.enabled
    this.profileOverrideId = saved.profileOverrideId
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

  get profileOptions(): OfflineLibraryProfile[] {
    return this.profiles?.profiles ?? []
  }

  get profileOverride(): OfflineLibraryProfile | null {
    return this.profileOptions.find(profile => profile.id === this.profileOverrideId) ?? null
  }

  profileForTask(taskKind: string): OfflineLibraryProfile | null {
    if (this.profileOverride) return this.profileOverride
    const selectedId = this.profiles?.selection[taskKind]
    return this.profileOptions.find(profile => profile.id === selectedId) ?? null
  }

  setProfileOverride(profileId: string | null): void {
    if (profileId !== null && !this.profileOptions.some(profile => profile.id === profileId)) return
    this.profileOverrideId = profileId
    this.saveSettings()
  }

  async initialize(): Promise<void> {
    if (this.enabled) await this.refresh()
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.available) return
    this.requestGeneration += 1
    this.enabled = enabled
    this.saveSettings()
    if (!enabled) {
      this.phase = 'disabled'
      this.manifest = null
      this.status = null
      this.profiles = null
      this.sources = null
      this.knowledgeArena = null
      this.detailsError = null
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
    const profiles = await this.service.getProfiles()
    if (!this.isCurrent(generation)) return
    if (!profiles.ok) {
      this.applyFailure(profiles)
      return
    }
    const [sources, knowledgeArena] = await Promise.all([
      this.service.getSources(),
      this.service.getKnowledgeArena(),
    ])
    if (!this.isCurrent(generation)) return
    runInAction(() => {
      this.status = status.data
      this.profiles = profiles.data
      this.sources = sources.ok ? sources.data : null
      this.knowledgeArena = knowledgeArena.ok ? knowledgeArena.data : null
      this.detailsError = !sources.ok
        ? sources.error.message
        : !knowledgeArena.ok ? knowledgeArena.error.message : null
      if (this.profileOverrideId && !profiles.data.profiles.some(profile => profile.id === this.profileOverrideId)) {
        this.profileOverrideId = null
        this.saveSettings()
      }
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
    this.profiles = null
    this.sources = null
    this.knowledgeArena = null
    this.detailsError = null
    this.error = error.message
    this.lastCheckedAt = Date.now()
    if (error.kind === 'incompatible') this.phase = 'incompatible'
    else if (error.kind === 'unavailable' || error.kind === 'timeout') this.phase = 'offline'
    else this.phase = 'error'
  }

  private saveSettings(): void {
    this.persistence.save({ version: 1, enabled: this.enabled, profileOverrideId: this.profileOverrideId })
  }
}

// Platform boundary for installed database plugins. The manager/query layers
// depend only on this interface, so lifecycle and query logic are testable with
// an injected fake and the desktop path stays a thin typed Tauri shim. The
// WebView never chooses an arbitrary host, path, method, or SQL statement — it
// calls named commands with bounded, typed arguments only.
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../core/runtime'
import { DatabasePluginValidationError } from './errors'
import type {
  DatabasePluginPayloadFile,
  InstalledDatabasePlugin,
} from './types'

/** One raw row returned by the host's read-only query builders. */
export interface PluginHostRow {
  recordId: string
  fields: Record<string, string | number | boolean | null>
}

export interface PluginHostSearchInput {
  pluginId: string
  version: string
  datasetPath: string
  searchId?: string
  query: string
  limit: number
}

export interface PluginHostLookupInput {
  pluginId: string
  version: string
  datasetPath: string
  lookupId: string
  parameters: Record<string, string | number | boolean>
  limit: number
}

/**
 * The app-managed plugin directory boundary. Implementations run host-defined
 * read-only query builders over immutable SQLite; they never accept SQL text.
 */
export interface PluginHost {
  /** False in Web Lite / non-desktop — install and query are desktop-only. */
  readonly available: boolean
  list(): Promise<InstalledDatabasePlugin[]>
  install(record: InstalledDatabasePlugin, files: DatabasePluginPayloadFile[]): Promise<void>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  search(input: PluginHostSearchInput): Promise<PluginHostRow[]>
  lookup(input: PluginHostLookupInput): Promise<PluginHostRow[]>
}

/** Desktop host backed by dedicated typed Tauri commands. */
export const tauriPluginHost: PluginHost = {
  get available() {
    return isTauri()
  },
  list: () => invoke<InstalledDatabasePlugin[]>('database_plugin_list'),
  install: (record, files) =>
    invoke<void>('database_plugin_install', {
      record,
      files: files.map(f => ({ path: f.path, bytes: Array.from(f.bytes) })),
    }),
  remove: id => invoke<void>('database_plugin_remove', { id }),
  setEnabled: (id, enabled) => invoke<void>('database_plugin_set_enabled', { id, enabled }),
  search: input => invoke<PluginHostRow[]>('database_plugin_search', { input }),
  lookup: input => invoke<PluginHostRow[]>('database_plugin_lookup', { input }),
}

/** Web Lite / non-desktop host: every operation is an honest desktop-only refusal. */
export const unavailablePluginHost: PluginHost = {
  available: false,
  list: async () => [],
  install: rejectWebLite,
  remove: rejectWebLite,
  setEnabled: rejectWebLite,
  search: rejectWebLite,
  lookup: rejectWebLite,
}

function rejectWebLite(): never {
  throw new DatabasePluginValidationError('web_lite', 'Database plugins can be installed and queried only in the GatesAI desktop app.')
}

/** Pick the host for the current runtime. */
export function defaultPluginHost(): PluginHost {
  return isTauri() ? tauriPluginHost : unavailablePluginHost
}

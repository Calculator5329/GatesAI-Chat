import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabasePluginSettingsPersistence, DEFAULT_DATABASE_PLUGIN_SETTINGS } from '../../../src/services/databasePlugins/persistence'

describe('database plugin settings persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips exact version-pinned enablement', () => {
    const persistence = createDatabasePluginSettingsPersistence()
    persistence.save({ version: 1, plugins: [{ id: 'demo.db', version: '1.0.0', enabled: true }] })
    expect(persistence.load()).toEqual({ version: 1, plugins: [{ id: 'demo.db', version: '1.0.0', enabled: true }] })
  })

  it('fails closed to defaults on future, duplicate, or unexpected data', () => {
    const persistence = createDatabasePluginSettingsPersistence()
    for (const value of [
      { version: 2, plugins: [] },
      { version: 1, plugins: [], authority: 'all' },
      { version: 1, plugins: [{ id: 'x', version: '1.0.0', enabled: true }, { id: 'x', version: '1.0.0', enabled: false }] },
      { version: 1, plugins: [{ id: 'x', version: '1.0.0', enabled: true, authority: 'all' }] },
    ]) {
      localStorage.setItem('gatesai.databasePlugins.v1', JSON.stringify(value))
      expect(persistence.load()).toEqual(DEFAULT_DATABASE_PLUGIN_SETTINGS)
    }
  })
})

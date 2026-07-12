import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../../src/core/runtime', () => ({ isTauri: mocks.isTauri }))

import { offlineLibraryService } from '../../src/services/offlineLibrary'
import plugin from '../fixtures/offline-library/v1.3/plugin.json'

describe('offlineLibraryService', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.isTauri.mockReturnValue(true)
  })

  it('uses only the dedicated typed Tauri commands', async () => {
    mocks.invoke.mockResolvedValueOnce(plugin)
    expect(await offlineLibraryService.getPlugin()).toEqual({ ok: true, data: plugin })
    expect(mocks.invoke).toHaveBeenCalledWith('offline_library_read', { resource: 'plugin', alias: undefined })

    mocks.invoke.mockResolvedValueOnce({ api_version: '1', matches: [] })
    await offlineLibraryService.search({ query: 'arch hooks', limit: 5, mode: 'hybrid', includeKiwix: true })
    expect(mocks.invoke).toHaveBeenLastCalledWith('offline_library_search', {
      request: { query: 'arch hooks', limit: 5, mode: 'hybrid', includeKiwix: true },
    })
  })

  it('never invokes loopback transport in Web Lite', async () => {
    mocks.isTauri.mockReturnValue(false)
    expect(await offlineLibraryService.getStatus()).toEqual({
      ok: false,
      error: { kind: 'web_lite', message: 'Offline Library is available only in the GatesAI desktop app.' },
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('preserves typed offline and HTTP states', async () => {
    mocks.invoke.mockRejectedValueOnce({ kind: 'unavailable', message: 'Offline Library is unavailable' })
    expect(await offlineLibraryService.getSources()).toEqual({
      ok: false,
      error: { kind: 'unavailable', status: undefined, message: 'Offline Library is unavailable' },
    })

    mocks.invoke.mockRejectedValueOnce({ kind: 'http', status: 404, message: 'Offline Library returned HTTP 404' })
    const result = await offlineLibraryService.getPublicSchema('not-public')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', status: 404, message: 'Offline Library returned HTTP 404' },
    })

    const invalid = await offlineLibraryService.search({
      query: ' ', limit: 5, mode: 'hybrid', includeKiwix: true,
    })
    expect(invalid).toEqual({
      ok: false,
      error: { kind: 'invalid_request', message: 'Query must contain 1 to 2000 characters' },
    })
  })

  it('preserves citation strings exactly', async () => {
    const response = {
      api_version: '1', query: 'hooks', mode: 'hybrid',
      matches: [{ uri: 'kiwix://archlinux/pacman-hooks' }, { uri: 'db://public/schema' }],
    }
    mocks.invoke.mockResolvedValueOnce(response)
    const result = await offlineLibraryService.search({ query: 'hooks', limit: 2, mode: 'hybrid', includeKiwix: true })
    expect(result).toEqual({ ok: true, data: response })
  })
})

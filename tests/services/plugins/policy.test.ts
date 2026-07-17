import { describe, expect, it } from 'vitest'
import {
  assertCapability,
  assertRouteAllowsDataPolicy,
  buildCitation,
  resolveEffectiveDataPolicy,
  resolveQueryLimits,
  tightenDataPolicy,
} from '../../../src/services/plugins/policy'
import { hostSatisfiesMinimum, compareVersions } from '../../../src/services/plugins/semver'
import { DATABASE_PLUGIN_BOUNDS } from '../../../src/services/plugins/bounds'
import type {
  DatabasePluginDatasetDescriptor,
  DatabasePluginManifest,
  InstalledDatabasePlugin,
} from '../../../src/services/plugins/types'
import { buildPackage } from './fixtures'

const manifest = (dataPolicy: 'local_only' | 'cloud_allowed'): DatabasePluginManifest =>
  buildPackage({ dataPolicy }).manifest

describe('data-policy ceiling', () => {
  it('defaults to local-only and only allows cloud when the manifest and user both allow it', () => {
    expect(resolveEffectiveDataPolicy(manifest('cloud_allowed'))).toBe('local_only')
    expect(resolveEffectiveDataPolicy(manifest('cloud_allowed'), true)).toBe('cloud_allowed')
    expect(resolveEffectiveDataPolicy(manifest('local_only'), true)).toBe('local_only')
  })

  it('refuses to loosen a local-only manifest', () => {
    const blocked = tightenDataPolicy(manifest('local_only'), 'cloud_allowed')
    expect(blocked.ok).toBe(false)
    expect(tightenDataPolicy(manifest('cloud_allowed'), 'cloud_allowed').ok).toBe(true)
    expect(tightenDataPolicy(manifest('cloud_allowed'), 'local_only').ok).toBe(true)
  })
})

describe('route + capability gates', () => {
  it('blocks local-only data on a cloud route', () => {
    expect(assertRouteAllowsDataPolicy('local_only', { isLocal: false })?.kind).toBe('data_policy_blocked')
    expect(assertRouteAllowsDataPolicy('local_only', { isLocal: true })).toBeNull()
    expect(assertRouteAllowsDataPolicy('cloud_allowed', { isLocal: false })).toBeNull()
  })

  it('requires the plugin to be enabled and to declare the capability', () => {
    const enabled: InstalledDatabasePlugin = {
      ...base(),
      enabled: true,
    }
    expect(assertCapability(enabled, 'search.read')).toBeNull()
    expect(assertCapability({ ...enabled, enabled: false }, 'search.read')?.kind).toBe('disabled')
    const narrowed: InstalledDatabasePlugin = {
      ...enabled,
      manifest: { ...enabled.manifest, capabilities: ['catalog.read'] },
    }
    expect(assertCapability(narrowed, 'search.read')?.kind).toBe('capability_denied')
  })
})

describe('resolveQueryLimits', () => {
  const dataset: DatabasePluginDatasetDescriptor = {
    id: 'people', title: 'People', description: '', path: 'data/people.sqlite',
  }

  it('takes the strictest of host, dataset, projection, and requested limits', () => {
    expect(resolveQueryLimits(dataset).maxResults).toBe(DATABASE_PLUGIN_BOUNDS.maxResults)
    expect(resolveQueryLimits({ ...dataset, maxResults: 10 }).maxResults).toBe(10)
    expect(resolveQueryLimits({ ...dataset, maxResults: 10 }, 3).maxResults).toBe(3)
    expect(resolveQueryLimits({ ...dataset, maxResults: 10 }, 3, { id: 's', description: '', maxResults: 2 }).maxResults).toBe(2)
    expect(resolveQueryLimits(dataset, 9_999).maxResults).toBe(DATABASE_PLUGIN_BOUNDS.maxResults)
    expect(resolveQueryLimits(dataset, 0).maxResults).toBe(DATABASE_PLUGIN_BOUNDS.maxResults)
  })
})

describe('buildCitation', () => {
  it('builds a stable opaque gatesdb URI and escapes the record id', () => {
    expect(buildCitation('com.example.people', '1.0.0', 'people', 'p1'))
      .toBe('gatesdb://com.example.people@1.0.0/people/p1')
    expect(buildCitation('com.example.people', '1.0.0', 'people', 'a/b'))
      .toBe('gatesdb://com.example.people@1.0.0/people/a%2Fb')
  })
})

describe('semver host compatibility', () => {
  it('compares versions and satisfies minimums', () => {
    expect(compareVersions('4.6.1', '4.6.0')).toBe(1)
    expect(compareVersions('4.6.1', '4.6.1')).toBe(0)
    expect(compareVersions('4.5.0', '4.6.0')).toBe(-1)
    expect(hostSatisfiesMinimum('4.6.1')).toBe(true)
    expect(hostSatisfiesMinimum('4.6.1', '4.6.0')).toBe(true)
    expect(hostSatisfiesMinimum('4.6.1', '5.0.0')).toBe(false)
  })
})

function base(): InstalledDatabasePlugin {
  const pkg = buildPackage()
  return {
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    manifest: pkg.manifest,
    enabled: false,
    installedAt: 0,
    source: pkg.source,
    effectiveDataPolicy: 'local_only',
  }
}

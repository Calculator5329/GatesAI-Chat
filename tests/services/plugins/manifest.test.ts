import { describe, expect, it } from 'vitest'
import {
  hasExecutableExtension,
  isSafePayloadPath,
  parseManifest,
  validateChecksums,
  validateManifest,
} from '../../../src/services/plugins/manifest'
import { DatabasePluginValidationError } from '../../../src/services/plugins/errors'
import { buildPackage } from './fixtures'

function manifestWith(mutate: (m: Record<string, unknown>) => void): Record<string, unknown> {
  const manifest = JSON.parse(JSON.stringify(buildPackage().manifest)) as Record<string, unknown>
  mutate(manifest)
  return manifest
}

describe('validateManifest', () => {
  it('accepts a valid schema-1 manifest and dedups capabilities', () => {
    const manifest = manifestWith(m => {
      m.capabilities = ['catalog.read', 'catalog.read', 'search.read', 'lookup.read', 'schema.read']
    })
    const result = validateManifest(manifest)
    expect(result.schemaVersion).toBe(1)
    expect(result.id).toBe('com.example.people')
    expect(result.capabilities).toEqual(['catalog.read', 'search.read', 'lookup.read', 'schema.read'])
    expect(result.dataPolicy).toBe('local_only')
  })

  it('rejects an unsupported schema version', () => {
    expect(() => validateManifest(manifestWith(m => { m.schemaVersion = 2 })))
      .toThrowError(/Unsupported schemaVersion/)
    expect((parseManifest(manifestWith(m => { m.schemaVersion = 2 })) as { error: { kind: string } }).error.kind)
      .toBe('unsupported_schema')
  })

  it('rejects a non-reverse-DNS id', () => {
    expect(kindOf(manifestWith(m => { m.id = 'People!' }))).toBe('invalid_manifest')
    expect(kindOf(manifestWith(m => { m.id = 'people' }))).toBe('invalid_manifest') // needs a dot segment
  })

  it('rejects a non-semver version', () => {
    expect(kindOf(manifestWith(m => { m.version = '1.0' }))).toBe('invalid_manifest')
  })

  it('rejects unknown capabilities and empty capability lists', () => {
    expect(kindOf(manifestWith(m => { m.capabilities = ['catalog.read', 'sql.write'] }))).toBe('invalid_manifest')
    expect(kindOf(manifestWith(m => { m.capabilities = [] }))).toBe('invalid_manifest')
  })

  it('rejects a capability with no backing dataset projection', () => {
    const manifest = manifestWith(m => {
      const datasets = m.datasets as Array<Record<string, unknown>>
      datasets[0].searches = []
    })
    expect(kindOf(manifest)).toBe('invalid_manifest')
  })

  it('rejects unsafe and duplicate dataset paths', () => {
    expect(kindOf(manifestWith(m => { (m.datasets as Array<Record<string, unknown>>)[0].path = '/etc/passwd' }))).toBe('unsafe_path')
    expect(kindOf(manifestWith(m => { (m.datasets as Array<Record<string, unknown>>)[0].path = '../escape.sqlite' }))).toBe('unsafe_path')
    expect(kindOf(manifestWith(m => { (m.datasets as Array<Record<string, unknown>>)[0].path = 'data\\people.sqlite' }))).toBe('unsafe_path')
    expect(kindOf(manifestWith(m => { (m.datasets as Array<Record<string, unknown>>)[0].path = 'payload.exe' }))).toBe('unsafe_path')
  })

  it('rejects duplicate dataset paths', () => {
    const manifest = manifestWith(m => {
      const datasets = m.datasets as Array<Record<string, unknown>>
      datasets.push({ ...datasets[0], id: 'people2' })
    })
    expect(kindOf(manifest)).toBe('duplicate_path')
  })

  it('rejects a malformed integrity digest', () => {
    expect(kindOf(manifestWith(m => { (m.integrity as Record<string, unknown>).digest = 'nothex' }))).toBe('invalid_manifest')
    expect(kindOf(manifestWith(m => { (m.integrity as Record<string, unknown>).algorithm = 'md5' }))).toBe('invalid_manifest')
  })

  it('parseManifest never throws on hostile input', () => {
    for (const garbage of [null, 42, 'x', [], {}, { schemaVersion: 1 }]) {
      const result = parseManifest(garbage)
      expect(result.ok).toBe(false)
    }
  })
})

describe('validateChecksums', () => {
  it('accepts a valid checksums document', () => {
    const pkg = buildPackage()
    expect(validateChecksums(pkg.checksums).files['data/people.sqlite']).toHaveLength(64)
  })

  it('rejects an empty file map, unsafe paths, and bad digests', () => {
    expect(kindOfThrow(() => validateChecksums({ algorithm: 'sha-256', files: {} }))).toBe('invalid_manifest')
    expect(kindOfThrow(() => validateChecksums({ algorithm: 'sha-256', files: { '../x': 'a'.repeat(64) } }))).toBe('unsafe_path')
    expect(kindOfThrow(() => validateChecksums({ algorithm: 'sha-256', files: { 'data/x.sqlite': 'short' } }))).toBe('invalid_manifest')
    expect(kindOfThrow(() => validateChecksums({ algorithm: 'md5', files: {} }))).toBe('invalid_manifest')
  })
})

describe('isSafePayloadPath / hasExecutableExtension', () => {
  it('accepts relative data paths', () => {
    expect(isSafePayloadPath('data/people.sqlite')).toBe(true)
    expect(isSafePayloadPath('indexes/people.idx')).toBe(true)
  })
  it('rejects traversal, absolute, drive, and executable paths', () => {
    for (const bad of ['/abs', 'a/../b', '..', './x', 'C:/x', 'a\\b', '', 'x/', '/x', 'a//b', 'a\0b']) {
      expect(isSafePayloadPath(bad)).toBe(false)
    }
    expect(hasExecutableExtension('data/tool.js')).toBe(true)
    expect(hasExecutableExtension('data/tool.wasm')).toBe(true)
    expect(hasExecutableExtension('data/people.sqlite')).toBe(false)
  })
})

function kindOf(value: unknown): string {
  const result = parseManifest(value)
  if (result.ok) throw new Error('expected failure')
  return result.error.kind
}

function kindOfThrow(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DatabasePluginValidationError) return error.kind
    throw error
  }
  throw new Error('expected throw')
}

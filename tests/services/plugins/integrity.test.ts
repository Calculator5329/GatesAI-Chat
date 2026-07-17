import { describe, expect, it } from 'vitest'
import {
  canonicalizeChecksums,
  computeChecksumsDigest,
  verifyPackageIntegrity,
} from '../../../src/services/plugins/integrity'
import { sha256Hex, sha256HexUtf8 } from '../../../src/services/plugins/sha256'
import { DatabasePluginValidationError } from '../../../src/services/plugins/errors'
import { bytes, buildPackage } from './fixtures'

describe('sha256', () => {
  it('matches known NIST vectors', () => {
    expect(sha256HexUtf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256HexUtf8('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256HexUtf8('The quick brown fox jumps over the lazy dog'))
      .toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592')
  })

  it('hashes multi-block input deterministically', () => {
    const long = 'x'.repeat(1000)
    expect(sha256HexUtf8(long)).toBe(sha256Hex(bytes(long)))
    expect(sha256HexUtf8(long)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('canonicalizeChecksums', () => {
  it('sorts file keys so the digest is order-independent', () => {
    const a = canonicalizeChecksums({ algorithm: 'sha-256', files: { b: '2', a: '1' } })
    const b = canonicalizeChecksums({ algorithm: 'sha-256', files: { a: '1', b: '2' } })
    expect(a).toBe(b)
  })
})

describe('verifyPackageIntegrity', () => {
  it('accepts a package whose bytes and digests all match', () => {
    const pkg = buildPackage()
    expect(verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files)).toBe(pkg.files[0].bytes.length)
  })

  it('rejects a manifest whose integrity digest does not match the checksums doc', () => {
    const pkg = buildPackage()
    pkg.manifest.integrity.digest = 'f'.repeat(64)
    expect(kind(() => verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files))).toBe('integrity_mismatch')
  })

  it('rejects tampered payload bytes', () => {
    const pkg = buildPackage()
    pkg.files[0].bytes = bytes('tampered content that no longer hashes to the checksum')
    expect(kind(() => verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files))).toBe('integrity_mismatch')
  })

  it('rejects a declared dataset with no checksum entry', () => {
    const pkg = buildPackage()
    delete pkg.checksums.files['data/people.sqlite']
    pkg.checksums.files['data/other.sqlite'] = sha256Hex(pkg.files[0].bytes)
    pkg.manifest.integrity.digest = computeChecksumsDigest(pkg.checksums)
    expect(kind(() => verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files))).toBe('checksum_missing')
  })

  it('rejects an extra payload file not listed in checksums', () => {
    const pkg = buildPackage()
    pkg.files.push({ path: 'data/smuggled.sqlite', bytes: bytes('extra') })
    expect(kind(() => verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files))).toBe('integrity_mismatch')
  })

  it('rejects a checksum entry with no provided file', () => {
    const pkg = buildPackage()
    pkg.checksums.files['data/missing.sqlite'] = sha256Hex(bytes('missing'))
    pkg.manifest.integrity.digest = computeChecksumsDigest(pkg.checksums)
    expect(kind(() => verifyPackageIntegrity(pkg.manifest, pkg.checksums, pkg.files))).toBe('checksum_missing')
  })
})

function kind(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DatabasePluginValidationError) return error.kind
    throw error
  }
  throw new Error('expected throw')
}

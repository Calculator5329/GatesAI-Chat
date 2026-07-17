// Integrity verification for database plugin packages. Proves payload bytes
// match the checksums document, and that the checksums document matches the
// manifest's integrity digest. Checksums prove payload integrity, not publisher
// identity (see the ADR threat model). Pure and synchronous.
import { DATABASE_PLUGIN_BOUNDS } from './bounds'
import { DatabasePluginValidationError } from './errors'
import { isSafePayloadPath } from './manifest'
import { sha256Hex, sha256HexUtf8 } from './sha256'
import type {
  DatabasePluginChecksums,
  DatabasePluginManifest,
  DatabasePluginPayloadFile,
} from './types'

/**
 * Canonical serialization of a checksums document: sorted file keys, fixed
 * key order, no incidental whitespace. The manifest integrity digest is the
 * sha-256 of this string, so both sides agree deterministically.
 */
export function canonicalizeChecksums(checksums: DatabasePluginChecksums): string {
  const sortedPaths = Object.keys(checksums.files).sort()
  const files: Record<string, string> = {}
  for (const path of sortedPaths) files[path] = checksums.files[path]
  return JSON.stringify({ algorithm: checksums.algorithm, files })
}

/** Digest that a manifest's `integrity.digest` must equal for the checksums doc. */
export function computeChecksumsDigest(checksums: DatabasePluginChecksums): string {
  return sha256HexUtf8(canonicalizeChecksums(checksums))
}

/**
 * Verify a full package. Throws a typed `DatabasePluginValidationError` on the
 * first violation. On success returns the total expanded byte count.
 *
 * Enforced, in order: manifest<->checksums digest binding, no unsafe/duplicate
 * payload paths, every declared dataset path present, every checksum entry
 * backed by a provided file (and vice versa), each file's bytes match its
 * digest, and the file-count / expanded-size ceilings.
 */
export function verifyPackageIntegrity(
  manifest: DatabasePluginManifest,
  checksums: DatabasePluginChecksums,
  files: DatabasePluginPayloadFile[],
): number {
  const expectedDigest = computeChecksumsDigest(checksums)
  if (expectedDigest !== manifest.integrity.digest) {
    throw new DatabasePluginValidationError('integrity_mismatch', 'Manifest integrity digest does not match the checksums document.')
  }

  const checksumPaths = Object.keys(checksums.files)
  if (checksumPaths.length > DATABASE_PLUGIN_BOUNDS.maxFiles) {
    throw new DatabasePluginValidationError('too_many_files', `Package declares ${checksumPaths.length} files, exceeding the ${DATABASE_PLUGIN_BOUNDS.maxFiles} limit.`)
  }
  if (files.length > DATABASE_PLUGIN_BOUNDS.maxFiles) {
    throw new DatabasePluginValidationError('too_many_files', `Package supplies ${files.length} files, exceeding the ${DATABASE_PLUGIN_BOUNDS.maxFiles} limit.`)
  }

  // Every declared dataset must have a checksum entry.
  for (const dataset of manifest.datasets) {
    if (!(dataset.path in checksums.files)) {
      throw new DatabasePluginValidationError('checksum_missing', `Dataset "${dataset.id}" path "${dataset.path}" has no checksum entry.`)
    }
  }

  // Index provided files, rejecting unsafe/duplicate paths defensively.
  const provided = new Map<string, Uint8Array>()
  let expandedBytes = 0
  for (const file of files) {
    if (!isSafePayloadPath(file.path)) {
      throw new DatabasePluginValidationError('unsafe_path', `Payload path "${file.path}" is not a safe relative path.`)
    }
    if (provided.has(file.path)) {
      throw new DatabasePluginValidationError('duplicate_path', `Payload path "${file.path}" appears more than once.`)
    }
    provided.set(file.path, file.bytes)
    expandedBytes += file.bytes.length
    if (expandedBytes > DATABASE_PLUGIN_BOUNDS.maxExpandedBytes) {
      throw new DatabasePluginValidationError('too_large', 'Expanded payload exceeds the size ceiling.')
    }
  }

  // Every checksum entry must be backed by exactly one provided file whose
  // bytes hash to the declared digest; no extra files may be smuggled in.
  for (const path of checksumPaths) {
    const bytes = provided.get(path)
    if (!bytes) {
      throw new DatabasePluginValidationError('checksum_missing', `Checksum declared for "${path}" but no payload file was provided.`)
    }
    const actual = sha256Hex(bytes)
    if (actual !== checksums.files[path]) {
      throw new DatabasePluginValidationError('integrity_mismatch', `Payload "${path}" digest mismatch.`)
    }
  }
  for (const path of provided.keys()) {
    if (!(path in checksums.files)) {
      throw new DatabasePluginValidationError('integrity_mismatch', `Payload "${path}" is not listed in the checksums document.`)
    }
  }

  return expandedBytes
}

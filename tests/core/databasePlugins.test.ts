import { describe, expect, it } from 'vitest'

import {
  DATABASE_PLUGIN_LIMITS,
  describeDatabasePluginSignature,
  parseDatabasePluginManifest,
} from '../../src/core/databasePlugins'

const fingerprint = `sha256:${'a'.repeat(64)}`

function validManifest(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'org.example.reference-data',
    version: '1.2.3',
    min_host_version: '4.6.1',
    min_schema_version: 1,
    publisher: { name: 'Example Foundation', url: 'https://example.org/' },
    provenance: { source: 'Example public reference corpus', retrieved_at: '2026-07-16T00:00:00Z' },
    package: {
      compressed_size_bytes: 1_000,
      expanded_size_bytes: 2_000,
      file_count: 3,
    },
    datasets: [{
      id: 'reference',
      title: 'Reference data',
      description: 'A small public reference dataset.',
      source: 'data/reference.sqlite',
      record_id_field: 'record_id',
      fields: [
        { name: 'record_id', type: 'string', description: 'Stable record identifier.' },
        { name: 'name', type: 'string', description: 'Display name.' },
        { name: 'year', type: 'integer', description: 'Reference year.' },
      ],
      lookups: [{
        name: 'by_id',
        description: 'Look up one record by stable ID.',
        parameters: [{ name: 'record_id', type: 'string', required: true, max_length: 100 }],
        result_fields: ['record_id', 'name', 'year'],
        max_results: 1,
        max_transcript_characters: 2_000,
      }],
      searches: [{
        name: 'by_name',
        description: 'Search names.',
        parameters: [
          { name: 'query', type: 'string', required: true, max_length: 200 },
          { name: 'year', type: 'integer', required: false, minimum: 1900, maximum: 2100 },
        ],
        result_fields: ['record_id', 'name'],
        max_results: 20,
        max_transcript_characters: 8_000,
      }],
    }],
    citation_namespace: 'example.reference',
    license: { spdx: 'CC-BY-4.0', notice_path: 'LICENSES/CC-BY-4.0.txt' },
    update: { catalog_id: 'example.public', url: 'https://example.org/catalog/reference-data.json' },
    data_policy: 'local_only',
    capabilities: ['catalog.read', 'schema.read', 'lookup.read', 'search.read'],
    signature: {
      algorithm: 'ed25519',
      key_fingerprint: fingerprint,
      signature_path: 'SIGNATURES/plugin.sig',
    },
  }
}

describe('database plugin schema 1', () => {
  it('parses a bounded data-only manifest', () => {
    const manifest = parseDatabasePluginManifest(validManifest())

    expect(manifest.id).toBe('org.example.reference-data')
    expect(manifest.datasets[0]?.searches[0]?.max_results).toBe(20)
    expect(manifest.signature?.key_fingerprint).toBe(fingerprint)
  })

  it.each([
    ['unknown executable hook', (manifest: Record<string, unknown>) => { manifest.install_script = 'run.sh' }],
    ['wrong schema', (manifest: Record<string, unknown>) => { manifest.schema_version = 2 }],
    ['unknown capability', (manifest: Record<string, unknown>) => { manifest.capabilities = ['filesystem.write'] }],
    ['credentialed update URL', (manifest: Record<string, unknown>) => {
      manifest.update = { catalog_id: 'example.public', url: 'https://token@example.org/catalog.json' }
    }],
    ['non-HTTPS update URL', (manifest: Record<string, unknown>) => {
      manifest.update = { catalog_id: 'example.public', url: 'http://example.org/catalog.json' }
    }],
    ['traversal source', (manifest: Record<string, unknown>) => {
      const dataset = ((manifest.datasets as Array<Record<string, unknown>>)[0])
      dataset.source = 'data/../../secrets.sqlite'
    }],
    ['executable source', (manifest: Record<string, unknown>) => {
      const dataset = ((manifest.datasets as Array<Record<string, unknown>>)[0])
      dataset.source = 'data/plugin.so'
    }],
    ['undeclared result field', (manifest: Record<string, unknown>) => {
      const dataset = ((manifest.datasets as Array<Record<string, unknown>>)[0])
      const search = ((dataset.searches as Array<Record<string, unknown>>)[0])
      search.result_fields = ['private_notes']
    }],
    ['unbounded string parameter', (manifest: Record<string, unknown>) => {
      const dataset = ((manifest.datasets as Array<Record<string, unknown>>)[0])
      const search = ((dataset.searches as Array<Record<string, unknown>>)[0])
      search.parameters = [{ name: 'query', type: 'string', required: true }]
    }],
    ['duplicate projection', (manifest: Record<string, unknown>) => {
      const dataset = ((manifest.datasets as Array<Record<string, unknown>>)[0])
      const searches = dataset.searches as Array<Record<string, unknown>>
      searches.push(structuredClone(searches[0]))
    }],
  ])('rejects hostile input: %s', (_name, mutate) => {
    const manifest = validManifest()
    mutate(manifest)
    expect(() => parseDatabasePluginManifest(manifest)).toThrow('Database plugin')
  })

  it('enforces archive and transcript declarations at or below host limits', () => {
    const tooLarge = validManifest()
    ;(tooLarge.package as Record<string, unknown>).expanded_size_bytes = DATABASE_PLUGIN_LIMITS.expandedBytes + 1
    expect(() => parseDatabasePluginManifest(tooLarge)).toThrow('expanded_size_bytes')

    const tooManyRows = validManifest()
    const dataset = ((tooManyRows.datasets as Array<Record<string, unknown>>)[0])
    const search = ((dataset.searches as Array<Record<string, unknown>>)[0])
    search.max_results = DATABASE_PLUGIN_LIMITS.results + 1
    expect(() => parseDatabasePluginManifest(tooManyRows)).toThrow('max_results')

    search.max_results = 1
    search.max_transcript_characters = DATABASE_PLUGIN_LIMITS.transcriptCharacters + 1
    expect(() => parseDatabasePluginManifest(tooManyRows)).toThrow('max_transcript_characters')
  })

  it('requires capabilities for declared lookup and search projections', () => {
    const manifest = validManifest()
    manifest.capabilities = ['catalog.read', 'schema.read']

    expect(() => parseDatabasePluginManifest(manifest)).toThrow('lookup.read')
  })
})

describe('database plugin signature labels', () => {
  const descriptor = {
    algorithm: 'ed25519' as const,
    key_fingerprint: fingerprint,
    signature_path: 'SIGNATURES/plugin.sig',
  }

  it('never turns a manifest signature into trust by itself', () => {
    expect(describeDatabasePluginSignature({
      descriptor,
      signatureVerified: true,
      signerTrusted: false,
    })).toEqual({
      kind: 'verified_untrusted',
      label: 'Signature verified — signer not trusted',
      fingerprint,
    })
  })

  it('distinguishes unsigned, invalid, and explicitly trusted states', () => {
    expect(describeDatabasePluginSignature({ signatureVerified: false, signerTrusted: false }).kind).toBe('unsigned')
    expect(describeDatabasePluginSignature({ descriptor, signatureVerified: false, signerTrusted: true }).kind).toBe('invalid')
    expect(describeDatabasePluginSignature({ descriptor, signatureVerified: true, signerTrusted: true }).kind).toBe('verified_trusted')
  })
})

import type { DatabasePluginManifest } from '../../src/core/databasePlugins'

export function validDatabasePluginManifest(): DatabasePluginManifest {
  return {
    schema_version: 1,
    id: 'demo.db',
    version: '1.0.0',
    min_host_version: '4.6.0',
    min_schema_version: 1,
    publisher: { name: 'Demo' },
    provenance: { source: 'fixture' },
    package: { compressed_size_bytes: 10, expanded_size_bytes: 20, file_count: 1 },
    datasets: [{
      id: 'places', title: 'Places', description: 'Demo places', source: 'data/places.sqlite', record_id_field: 'id',
      fields: [{ name: 'id', type: 'string', description: 'Record id' }, { name: 'name', type: 'string', description: 'Name' }],
      lookups: [{ name: 'by_id', description: 'Lookup by id', parameters: [{ name: 'id', type: 'string', required: true, max_length: 100 }], result_fields: ['id', 'name'], max_results: 1, max_transcript_characters: 1000 }],
      searches: [],
    }],
    citation_namespace: 'demo',
    license: { spdx: 'CC0-1.0', notice_path: 'LICENSES/NOTICE.txt' },
    update: { catalog_id: 'demo.db', url: 'https://example.com/demo.json' },
    data_policy: 'local_only',
    capabilities: ['catalog.read', 'schema.read', 'lookup.read'],
  }
}

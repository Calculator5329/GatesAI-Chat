import type { Tool } from './types';

export const libraryTool: Tool = {
  def: {
    name: 'library',
    description: [
      'Search and inspect the user-approved local knowledge library.',
      'The library contains workspace documents plus schema-only views of registered SQLite databases.',
      'Actions: list_sources, search, database_schema.',
      'Use sqlite_query for bounded read-only rows only after database_schema identifies the relevant registered database.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_sources', 'search', 'database_schema'] },
        query: { type: 'string', description: 'Question or phrase for semantic library search.' },
        source_id: { type: 'string', description: 'Registered source id for database_schema.' },
        limit: { type: 'number', description: 'Maximum search matches, 1-10. Default 5.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'memory',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 10_000, summarizeLargeOutput: true },
  },
  async execute(args, ctx) {
    if (!ctx.library) return 'Error: local library is unavailable.';
    const action = typeof args.action === 'string' ? args.action : '';
    if (action === 'list_sources') {
      const active = ctx.library.sources.filter(source => source.enabled);
      if (active.length === 0) return 'No local library sources are enabled. Add sources under Agent → Memory → Knowledge library.';
      return active.map(source => [
        `source_id: ${source.id}`,
        `title: ${source.title}`,
        `kind: ${source.kind}`,
        `path: ${source.path}`,
        `status: ${source.status}`,
      ].join('\n')).join('\n\n');
    }
    if (action === 'search') {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return 'Error: `query` is required for library search.';
      if (!ctx.rag?.active || !ctx.rag.recallLibrary) return 'Error: semantic library search needs the configured local Ollama embedding model.';
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(10, Math.floor(args.limit))) : 5;
      return ctx.rag.recallLibrary(query, limit);
    }
    if (action === 'database_schema') {
      const sourceId = typeof args.source_id === 'string' ? args.source_id.trim() : '';
      const source = ctx.library.sources.find(item => item.id === sourceId && item.kind === 'database' && item.enabled);
      if (!source) return 'Error: `source_id` must name an enabled database returned by list_sources.';
      const document = ctx.library.documents.get(source.id);
      return document?.text ?? `Error: schema for ${source.title} is not ready. Refresh the library in Agent settings.`;
    }
    return 'Error: `action` must be list_sources, search, or database_schema.';
  },
};

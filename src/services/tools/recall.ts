import type { Tool } from './types';

export const recallTool: Tool = {
  def: {
    name: 'recall',
    description: 'Search local semantic memory across past chat messages, notes, and saved memory facts. Use when the user asks what was discussed before or when past context would help.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language search query for past local context.',
        },
        k: {
          type: 'number',
          description: 'Maximum number of matches to return. Defaults to 6.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  meta: {
    category: 'memory',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 4_000, summarizeLargeOutput: false },
  },
  async execute(args, ctx) {
    if (!ctx.rag?.active) return 'Semantic memory is unavailable.';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return 'Error: `query` is required.';
    const k = typeof args.k === 'number' && Number.isFinite(args.k)
      ? Math.max(1, Math.min(20, Math.floor(args.k)))
      : 6;
    return ctx.rag.recall(query, k);
  },
};

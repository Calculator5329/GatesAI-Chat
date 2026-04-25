import type { Note } from '../../core/notes';
import type { Tool } from './types';

/**
 * Long-form notes — the companion to `memory`.
 *
 *   memory  →  short atomic facts about *the user*, injected into every
 *              system prompt
 *   notes   →  titled documents (project briefs, meeting summaries, code
 *              snippets, reference material) the user wants to keep but
 *              that don't belong in the prompt every turn
 *
 * The model searches and reads notes on demand. New notes never leak into
 * the system prompt automatically — they're only seen when the model asks
 * for them, which keeps cost predictable as the corpus grows.
 *
 * One tool, six verbs. Same shape as `memory` so the model only has to
 * learn one pattern.
 */
export const notesTool: Tool = {
  def: {
    name: 'notes',
    description: [
      'Manage long-form notes (titled documents) on the user\'s behalf.',
      '',
      '• `create` — write a new note. Requires `title` and `body`. Optional `tags` (string array).',
      '• `read` — fetch one note in full by `id`.',
      '• `update` — patch any of `title` / `body` / `tags` for an existing `id`.',
      '• `delete` — remove a note by `id`.',
      '• `search` — substring search across title, body, and tags. Returns up to `limit` matches (default 10) as `id + title + snippet`.',
      '• `list` — return the `limit` most-recently-updated notes (default 10) as `id + title + tags + updatedAt`.',
      '',
      'Use notes for things that are too large or too situational for `memory`: meeting recaps, project specs, recipes, research summaries, code snippets the user wants to keep. Use `memory` for short atomic facts about the user themselves.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'read', 'update', 'delete', 'search', 'list'] },
        id: { type: 'string', description: 'Note id (for read / update / delete).' },
        title: { type: 'string', description: 'Note title (for create / update).' },
        body: { type: 'string', description: 'Note body, supports markdown (for create / update).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (for create / update).' },
        query: { type: 'string', description: 'Search query (for search).' },
        limit: { type: 'number', description: 'Max results to return (for search / list). Default 10.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'notes',
    isReadOnly: args => ['read', 'search', 'list'].includes(String(args.action ?? '')),
    hasSideEffects: args => !['read', 'search', 'list'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 8_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    if (!ctx.notes) return 'Error: notes store unavailable in this context.';
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'create': return doCreate(args, ctx);
      case 'read':   return doRead(args, ctx);
      case 'update': return doUpdate(args, ctx);
      case 'delete': return doDelete(args, ctx);
      case 'search': return doSearch(args, ctx);
      case 'list':   return doList(args, ctx);
      default:       return `Error: unknown action "${action}". Valid: create, read, update, delete, search, list.`;
    }
  },
};

function doCreate(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const title = typeof args.title === 'string' ? args.title : '';
  const body = typeof args.body === 'string' ? args.body : '';
  if (!title.trim()) return 'Error: `title` is required for create.';
  if (!body.trim()) return 'Error: `body` is required for create.';
  const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined;
  const note = ctx.notes.create({ title, body, tags });
  return `Created note ${note.id}: "${note.title}"`;
}

function doRead(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const id = typeof args.id === 'string' ? args.id : '';
  if (!id) return 'Error: `id` is required for read.';
  const note = ctx.notes.findById(id);
  if (!note) return `Error: no note with id "${id}".`;
  return formatFull(note);
}

function doUpdate(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const id = typeof args.id === 'string' ? args.id : '';
  if (!id) return 'Error: `id` is required for update.';
  const patch: { title?: string; body?: string; tags?: string[] } = {};
  if (typeof args.title === 'string') patch.title = args.title;
  if (typeof args.body === 'string') patch.body = args.body;
  if (Array.isArray(args.tags)) patch.tags = args.tags.filter((t): t is string => typeof t === 'string');
  if (Object.keys(patch).length === 0) return 'Error: provide at least one of `title`, `body`, or `tags`.';
  const updated = ctx.notes.update(id, patch);
  if (!updated) return `Error: no note with id "${id}".`;
  return `Updated note ${updated.id}: "${updated.title}"`;
}

function doDelete(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const id = typeof args.id === 'string' ? args.id : '';
  if (!id) return 'Error: `id` is required for delete.';
  const removed = ctx.notes.remove(id);
  if (!removed) return `Error: no note with id "${id}".`;
  return `Deleted note ${removed.id}: "${removed.title}"`;
}

function doSearch(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) return 'Error: `query` is required for search.';
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;
  const hits = ctx.notes.search(query).slice(0, limit);
  if (hits.length === 0) return `No notes matched "${query}".`;
  return hits.map(formatHit).join('\n\n');
}

function doList(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;
  const all = ctx.notes.sortedByRecency.slice(0, limit);
  if (all.length === 0) return 'No notes stored yet.';
  return all.map(formatLine).join('\n');
}

function formatLine(n: Note): string {
  const tags = n.tags && n.tags.length > 0 ? `  [${n.tags.join(', ')}]` : '';
  return `${n.id}  "${n.title}"${tags}  (updated ${new Date(n.updatedAt).toISOString()})`;
}

function formatHit(n: Note): string {
  const snippet = n.body.length > 200 ? `${n.body.slice(0, 200)}…` : n.body;
  const tags = n.tags && n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : '';
  return `${n.id}  "${n.title}"${tags}\n${snippet}`;
}

function formatFull(n: Note): string {
  const tags = n.tags && n.tags.length > 0 ? `\nTags: ${n.tags.join(', ')}` : '';
  return [
    `id: ${n.id}`,
    `title: ${n.title}${tags}`,
    `created: ${new Date(n.createdAt).toISOString()}`,
    `updated: ${new Date(n.updatedAt).toISOString()}`,
    '',
    n.body,
  ].join('\n');
}

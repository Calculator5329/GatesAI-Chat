import type { Thread } from '../../core/types';
import type { Tool } from './types';

/**
 * Meta-tool: lets the model manage the conversation it lives inside.
 *
 * This is what makes `threadContext` actually usable end-to-end. Until now
 * the field existed in the data model with no way to set it; the model can
 * now ask the user "what's this thread about?" and persist the answer with
 * `set_context`, and every subsequent turn (in this thread) gets that
 * context injected into the system prompt automatically.
 *
 * Verbs:
 *   • `rename`         — change the current (or specified) thread's title
 *   • `set_context`    — write the per-thread context string
 *   • `get_context`    — read it back
 *   • `summarize_now`  — force the lazy summarizer to digest this thread
 *                        immediately (useful before `switch_to`-ing away)
 *   • `switch_to`      — make a different thread active; the running stream
 *                        survives, the user just lands on the new thread
 *   • `list`           — recent threads (id, title, updatedAt, summary if any)
 *
 * All actions default to the *calling* thread when an `id` would otherwise
 * be required. The model rarely has any other thread's id memorized — it
 * gets them from `list`.
 */
export const threadTool: Tool = {
  def: {
    name: 'thread',
    description: [
      'Manage the conversation thread you\'re in (or another one).',
      '',
      '• `rename` — change a thread\'s title. Optional `id` (defaults to current). Requires `title`.',
      '• `set_context` — store a short note about what this thread is for. It gets injected into your system prompt every turn under "About this conversation". Optional `id`. Requires `context` (pass empty string to clear).',
      '• `get_context` — read the current per-thread context. Optional `id`.',
      '• `summarize_now` — force-generate a summary of a thread right now (the background summarizer is lazy). Optional `id`.',
      '• `switch_to` — make a different thread the active one for the user. Requires `id`. Any in-flight reply on the old thread keeps streaming.',
      '• `list` — return up to `limit` (default 10) recently-updated threads as `id + title + updatedAt + summary`.',
      '',
      'Use `set_context` proactively when the user describes a long-running project / topic — future turns will be much better-grounded.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['rename', 'set_context', 'get_context', 'summarize_now', 'switch_to', 'list'] },
        id: { type: 'string', description: 'Thread id. For most actions defaults to the current thread; required for `switch_to`.' },
        title: { type: 'string', description: 'New thread title (for rename).' },
        context: { type: 'string', description: 'Per-thread context string (for set_context). Empty string clears it.' },
        limit: { type: 'number', description: 'Max threads to return (for list). Default 10.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'thread',
    isReadOnly: args => ['get_context', 'list'].includes(String(args.action ?? '')),
    hasSideEffects: args => !['get_context', 'list'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 4_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    const action = typeof args.action === 'string' ? args.action : '';
    const targetId = typeof args.id === 'string' && args.id ? args.id : ctx.threadId;

    switch (action) {
      case 'rename': {
        const title = typeof args.title === 'string' ? args.title : '';
        if (!title.trim()) return 'Error: `title` is required for rename.';
        const thread = ctx.chat.threads.find(t => t.id === targetId);
        if (!thread) return `Error: no thread with id "${targetId}".`;
        ctx.chat.renameThread(targetId, title);
        return `Renamed ${targetId} → "${title.trim()}"`;
      }
      case 'set_context': {
        if (typeof args.context !== 'string') return 'Error: `context` (string) is required for set_context. Pass "" to clear.';
        const thread = ctx.chat.threads.find(t => t.id === targetId);
        if (!thread) return `Error: no thread with id "${targetId}".`;
        ctx.chat.setThreadContext(targetId, args.context);
        return args.context.trim()
          ? `Set context for ${targetId} (${args.context.length} chars).`
          : `Cleared context for ${targetId}.`;
      }
      case 'get_context': {
        const thread = ctx.chat.threads.find(t => t.id === targetId);
        if (!thread) return `Error: no thread with id "${targetId}".`;
        return thread.threadContext?.trim()
          ? thread.threadContext
          : '(no context set for this thread)';
      }
      case 'summarize_now': {
        if (!ctx.summary) return 'Error: summary store unavailable in this context.';
        const thread = ctx.chat.threads.find(t => t.id === targetId);
        if (!thread) return `Error: no thread with id "${targetId}".`;
        const ok = await ctx.summary.summarizeNow(targetId);
        if (!ok) return `Could not summarize ${targetId} right now (another summary may be in flight).`;
        const refreshed = ctx.chat.threads.find(t => t.id === targetId);
        return refreshed?.summary?.trim()
          ? `Summary updated for ${targetId}: ${refreshed.summary}`
          : `Summary attempted for ${targetId}, but no text was produced.`;
      }
      case 'switch_to': {
        if (typeof args.id !== 'string' || !args.id) return 'Error: `id` is required for switch_to.';
        const thread = ctx.chat.threads.find(t => t.id === args.id);
        if (!thread) return `Error: no thread with id "${args.id}".`;
        if (thread.deletedAt != null) return `Error: thread "${args.id}" is deleted. Restore it before switching to it.`;
        if (!ctx.chat.selectThread(args.id)) return `Error: could not switch to thread "${args.id}".`;
        return `Switched active thread to ${args.id} ("${thread.title}").`;
      }
      case 'list': {
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;
        const sorted = ctx.chat.threads
          .filter(t => t.deletedAt == null)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit);
        if (sorted.length === 0) return 'No threads.';
        return sorted.map(formatThreadLine).join('\n');
      }
      default:
        return `Error: unknown action "${action}". Valid: rename, set_context, get_context, summarize_now, switch_to, list.`;
    }
  },
};

function formatThreadLine(t: Thread): string {
  const summary = t.summary?.trim() ? `  — ${t.summary.trim()}` : '';
  return `${t.id}  "${t.title}"  (updated ${new Date(t.updatedAt).toISOString()})${summary}`;
}

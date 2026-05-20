// Defines the memory tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { Tool } from './types';

/**
 * One tool, four verbs. Mirrors OpenAI's `bio` tool design — concentrating
 * memory verbs (add / remove / update / list) into a single tool keeps the
 * model's tool catalog small and avoids it having to choose between four
 * near-identical entries every turn.
 *
 * Storage backs onto `UserProfileStore.facts` (parsed bio). All actions are
 * pure mutations on that array; no side effects beyond the bio string.
 *
 * The model sees one tool with a clear `action` enum. It calls
 * `memory({ action: 'add', fact: '…' })` to save, `action: 'remove'` with
 * either a `fact` substring or a `index` to delete, and `action: 'list'`
 * to read back what's stored (useful when the user asks "what do you know
 * about me?" — the model can look it up rather than hallucinate).
 */
export const memoryTool: Tool = {
  def: {
    name: 'memory',
    description: [
      'Manage long-term memory about the user. One tool with four actions:',
      '',
      '• `add` — save a single durable fact. Use proactively for things the user says are persistent: identity, role, preferences, recurring projects. Do NOT save transient context (today\'s plans, hypotheticals, things they asked you to forget). One fact per call. Write in third person ("User prefers concise answers").',
      '• `remove` — forget a fact. Pass either `fact` (substring match — first hit wins) or `index` (0-based, from `list`).',
      '• `update` — replace a fact. Pass `fact` (substring match) plus `next` (the new value), or `index` plus `next`.',
      '• `list` — return the current facts as a numbered list. Use this when the user asks what you remember about them.',
      '',
      'Memory persists across all conversations and surfaces in your system prompt every turn under "About the user".',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'update', 'list'],
          description: 'Which memory operation to perform.',
        },
        fact: {
          type: 'string',
          description: 'For `add`: the fact to save. For `remove` / `update`: a substring of the existing fact to find (case-insensitive, first match wins).',
        },
        index: {
          type: 'number',
          description: 'For `remove` / `update`: 0-based index into the list returned by `action: "list"`. Use this when you know the exact position.',
        },
        next: {
          type: 'string',
          description: 'For `update`: the new fact text that will replace the matched/indexed fact.',
        },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'memory',
    isReadOnly: args => args.action === 'list',
    hasSideEffects: args => args.action !== 'list',
    resultPolicy: { maxChars: 2_000, summarizeLargeOutput: false },
  },

  async execute(args, ctx) {
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'add':       return doAdd(args, ctx);
      case 'remove':    return doRemove(args, ctx);
      case 'update':    return doUpdate(args, ctx);
      case 'list':      return doList(ctx);
      default:          return `Error: unknown action "${action}". Valid actions: add, remove, update, list.`;
    }
  },
};

function doAdd(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
  if (!fact) return 'Error: `fact` is required for action "add".';
  if (fact.length > 500) return 'Error: fact is too long. Keep it under 500 characters; one idea per call.';
  const added = ctx.profile.addFact(fact);
  return added
    ? `Saved: "${fact}"`
    : `Already remembered (no duplicate added): "${fact}"`;
}

function doRemove(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  if (typeof args.index === 'number') {
    const removed = ctx.profile.removeFactAt(args.index);
    return removed
      ? `Removed (#${args.index}): "${removed}"`
      : `Error: no fact at index ${args.index}. Try \`action: "list"\` first.`;
  }
  const match = typeof args.fact === 'string' ? args.fact : '';
  if (!match.trim()) return 'Error: provide either `index` or `fact` (a substring to match).';
  const removed = ctx.profile.removeFactMatching(match);
  return removed
    ? `Removed: "${removed}"`
    : `Error: no fact matched "${match}". Try \`action: "list"\` to see what's stored.`;
}

function doUpdate(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): string {
  const next = typeof args.next === 'string' ? args.next.trim() : '';
  if (!next) return 'Error: `next` (the new fact text) is required for action "update".';
  if (next.length > 500) return 'Error: `next` is too long. Keep it under 500 characters.';

  if (typeof args.index === 'number') {
    const updated = ctx.profile.updateFactAt(args.index, next);
    return updated
      ? `Updated (#${args.index}) to: "${updated}"`
      : `Error: no fact at index ${args.index}.`;
  }
  const match = typeof args.fact === 'string' ? args.fact : '';
  if (!match.trim()) return 'Error: provide either `index` or `fact` (a substring to match).';
  const updated = ctx.profile.updateFactMatching(match, next);
  return updated
    ? `Updated to: "${updated}"`
    : `Error: no fact matched "${match}". Try \`action: "list"\`.`;
}

function doList(ctx: Parameters<Tool['execute']>[1]): string {
  const facts = ctx.profile.facts;
  if (facts.length === 0) return 'No facts stored yet.';
  return facts.map((f, i) => `${i}. ${f}`).join('\n');
}

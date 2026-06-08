// Defines the logs tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on the diagnostics logger.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { Tool } from './types';
import { formatLogEntry, recentLogs, type LogLevel } from '../diagnostics/logger';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Lets the assistant read GatesAI Chat's own recent diagnostic logs so it can
 * self-diagnose ("why did that image job fail?", "did the bridge drop?").
 * Reads the in-memory ring buffer, so it works in every runtime even when the
 * bridge is offline; the same entries are also persisted to
 * `/workspace/logs/app-<date>.log` on desktop for cross-session forensics.
 */
export const logsTool: Tool = {
  def: {
    name: 'logs',
    description: [
      "Read GatesAI Chat's own recent runtime logs to diagnose errors or",
      'unexpected behavior. Returns recent entries (warnings, errors, and',
      'lifecycle events) from chat turns, tool calls, the bridge, image jobs,',
      'and persistence. Optional filters: `level` (minimum severity),',
      '`scope` (subsystem substring like "image-jobs" or "bridge"), and',
      '`limit`. Use this when something failed and you want evidence before',
      'guessing.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: LEVELS, description: 'Minimum severity to include (default: debug).' },
        scope: { type: 'string', description: 'Case-insensitive subsystem filter, e.g. "image-jobs".' },
        limit: { type: 'number', description: 'Max entries to return, newest last (default 100).' },
      },
    },
  },
  meta: {
    category: 'diagnostics',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 8_000, summarizeLargeOutput: true },
  },

  async execute(args) {
    const level = typeof args.level === 'string' && LEVELS.includes(args.level as LogLevel)
      ? (args.level as LogLevel)
      : undefined;
    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : undefined;
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined;

    const entries = recentLogs({ level, scope, limit });
    if (entries.length === 0) {
      return [
        'status: ok',
        'tool: logs',
        'summary: no log entries match the current filters',
      ].join('\n');
    }
    const body = entries.map(formatLogEntry).join('\n');
    return `status: ok\ntool: logs\nsummary: ${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'}\n\n${body}`;
  },
};

// Central application logger — the single sanctioned boundary for runtime
// diagnostics. Everything that used to call `console.*` goes through here so we
// get three things at once: a level-filtered console in dev, an in-memory ring
// buffer the `logs` tool can read for self-diagnosis, and (on desktop) a
// persisted JSONL trail under `/workspace/logs/` that survives reloads.
//
// Layer note: this is a service, so stores and other services may import it.
// UI never logs directly — it dispatches to a store, which logs. The console
// calls below are the ONLY console usage allowed in the app; `eslint.config.js`
// grants `services/diagnostics/**` an exemption from the `no-console` rule.
import type { BridgeClient } from '../bridge/client';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO-8601 timestamp. */
  t: string;
  level: LogLevel;
  /** Short subsystem tag, e.g. `chat`, `image-jobs`, `bridge`. */
  scope: string;
  message: string;
  /** Optional structured payload (errors are normalized to a readable shape). */
  data?: unknown;
}

interface LogSinkDeps {
  isOnline: boolean;
  client: Pick<BridgeClient, 'request'>;
}

const RING_CAPACITY = 500;
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const ring: LogEntry[] = [];
let sink: LogSinkDeps | null = null;

/**
 * Wire the persistent file sink. Called once from `RootStore` on desktop with a
 * live view of bridge connectivity; passing `null` disables file writes (web).
 */
export function configureLogSink(deps: LogSinkDeps | null): void {
  sink = deps;
}

function normalizeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data;
}

function writeConsole(entry: LogEntry): void {
  // In production we keep the console quiet for routine debug/info noise but
  // always surface warnings and errors.
  if (!import.meta.env.DEV && LEVEL_ORDER[entry.level] < LEVEL_ORDER.warn) return;
  const prefix = `[${entry.scope}]`;
  const args = entry.data !== undefined ? [prefix, entry.message, entry.data] : [prefix, entry.message];
  if (entry.level === 'error') console.error(...args);
  else if (entry.level === 'warn') console.warn(...args);
  else console.log(...args);
}

function writeFile(entry: LogEntry): void {
  const active = sink;
  if (!active?.isOnline) return;
  // Fire-and-forget on a microtask so logging never blocks the caller and a
  // dropped write (bridge offline mid-flight) can never throw into app code.
  queueMicrotask(() => {
    if (!active.isOnline) return;
    const day = entry.t.slice(0, 10);
    const append = (path: string, line: string) => {
      void active.client.request('fs.write', {
        path,
        content: line,
        encoding: 'utf8',
        append: true,
      }).catch(() => { /* diagnostics are best-effort */ });
    };
    append(`/workspace/logs/app-${day}.log`, JSON.stringify(entry) + '\n');
    // Warnings and errors additionally land in a dedicated error trail so
    // failure data accumulates in one greppable place across sessions —
    // the raw material for spotting recurring bugs and regressions.
    if (LEVEL_ORDER[entry.level] >= LEVEL_ORDER.warn) {
      append(`/workspace/logs/errors-${day}.jsonl`, JSON.stringify(entry) + '\n');
    }
  });
}

function emit(level: LogLevel, scope: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    t: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data !== undefined ? { data: normalizeData(data) } : {}),
  };
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
  writeConsole(entry);
  writeFile(entry);
}

/**
 * The app-wide logger. Use a stable, lowercase `scope` per subsystem so logs
 * stay greppable. Common scopes (see also `docs/tech_spec.md`):
 *
 * - `chat` — turn failures, stale finalize skip, auto-naming
 * - `persistence` — quarantine, compaction, multi-tab, workspace save
 * - `security` — protected chat-history denials
 * - `bridge` — connect/offline transitions
 * - `image-jobs` — dispatch, cancel, recovery
 * - `summary` — background summarization failures
 * - `models` / `llm` / `local-runtime` / `attachments` / `search` / `tools`
 */
export const logger = {
  debug: (scope: string, message: string, data?: unknown) => emit('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) => emit('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => emit('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) => emit('error', scope, message, data),
};

export interface RecentLogQuery {
  /** Minimum level to include (inclusive). Defaults to `debug`. */
  level?: LogLevel;
  /** Case-insensitive substring match against `scope`. */
  scope?: string;
  /** Max entries returned, newest last. Defaults to 100, capped at the buffer. */
  limit?: number;
}

/** Snapshot of recent in-memory log entries, oldest → newest. */
export function recentLogs(query: RecentLogQuery = {}): LogEntry[] {
  const minLevel = LEVEL_ORDER[query.level ?? 'debug'];
  const scopeNeedle = query.scope?.toLowerCase();
  const filtered = ring.filter(e =>
    LEVEL_ORDER[e.level] >= minLevel
    && (scopeNeedle ? e.scope.toLowerCase().includes(scopeNeedle) : true),
  );
  const limit = Math.max(1, Math.min(query.limit ?? 100, RING_CAPACITY));
  return filtered.slice(-limit);
}

/** One-line human/agent-readable rendering of a log entry. */
export function formatLogEntry(entry: LogEntry): string {
  const base = `${entry.t} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}`;
  if (entry.data === undefined) return base;
  let payload: string;
  try {
    payload = JSON.stringify(entry.data);
  } catch {
    payload = '[unserializable]';
  }
  if (payload.length > 800) payload = `${payload.slice(0, 800)}...[truncated]`;
  return `${base} ${payload}`;
}

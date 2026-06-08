// Provides opt-in runtime logging hooks for chat and tool diagnostics.
// Called by stores/services on critical-path events; depends on explicit configuration before logging.
// Invariant: diagnostics are best-effort and never block user-visible work.
import type { BridgeClient } from '../bridge/client';
import { logger } from './logger';

/**
 * Lightweight per-thread debug logger that appends JSONL lines to
 * `/workspace/logs/<thread-id>.log` via the bridge. Fire-and-forget — we
 * never throw or block the caller. If the bridge is offline the log is
 * silently dropped (and shadow-printed to console so devs can still see it).
 *
 * Use this when you need to reconstruct what actually happened on a turn:
 * raw provider request bodies, HTTP statuses, SSE chunks, finish reasons,
 * tool-call rounds. Treat it as a write-once forensic trail, not a
 * structured store.
 */

interface LoggerDeps {
  isOnline: boolean;
  client: Pick<BridgeClient, 'request'>;
}

let deps: LoggerDeps | null = null;

export function configureChatLog(d: LoggerDeps): void {
  deps = d;
}

function debugChatLogsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem('gatesai.debug.chatLog') === '1';
  } catch {
    return false;
  }
}

export function logEvent(threadId: string | null | undefined, tag: string, payload?: unknown): void {
  const shouldWrite = deps?.isOnline === true;
  const shouldDebug = debugChatLogsEnabled();
  if (!shouldWrite && !shouldDebug) return;

  queueMicrotask(() => {
    if (shouldDebug) logger.debug(`log:${threadId ?? 'global'}`, tag, payload);
    if (!shouldWrite || !deps?.isOnline) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      tag,
      ...(payload !== undefined ? { payload } : {}),
    }) + '\n';
    const id = threadId ?? 'global';
    const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_');
    const path = `/workspace/logs/${safe}.log`;

    // Fire-and-forget; swallow errors so logging never breaks the app.
    void deps.client.request('fs.write', {
      path,
      content: line,
      encoding: 'utf8',
      append: true,
    }).catch(() => { /* ignore */ });
  });
}

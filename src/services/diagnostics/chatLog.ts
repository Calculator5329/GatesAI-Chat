import type { BridgeClient } from '../bridge/client';

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

export function logEvent(threadId: string | null | undefined, tag: string, payload?: unknown): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    tag,
    ...(payload !== undefined ? { payload } : {}),
  }) + '\n';

  console.log(`[log:${threadId ?? 'global'}] ${tag}`, payload ?? '');

  if (!deps?.isOnline) return;
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
}

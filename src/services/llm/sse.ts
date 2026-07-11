import { readTextFrames, sseDataAdapter } from './streamCore';

/**
 * Minimal Server-Sent Events parser for `fetch`-based streaming.
 *
 * Yields one *data line* at a time (without the leading `data: `). Returns
 * when the stream ends or `signal` aborts.
 */
export async function* parseSse(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (!response.body) return;
  yield* readTextFrames(response.body, sseDataAdapter(), signal);
}

/** Throws a friendly error for non-2xx fetch responses. */
export async function ensureOk(response: Response, providerName: string): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch { /* ignore */ }
  throw new Error(`${providerName} ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
}

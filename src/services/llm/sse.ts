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
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data) yield data;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
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

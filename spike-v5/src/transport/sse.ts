// Incremental SSE line framing. EOF discards an unterminated event.
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let line = '';
  let afterCR = false;
  let data: string[] = [];
  let abort!: () => void;
  const aborted = new Promise<undefined>(resolve => { abort = () => resolve(undefined); });
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  function acceptLine(): string | undefined {
    const current = line;
    line = '';
    if (!current) {
      const payload = data.length ? data.join('\n') : undefined;
      data = [];
      return payload;
    }
    const colon = current.indexOf(':');
    const field = colon < 0 ? current : current.slice(0, colon);
    let value = colon < 0 ? '' : current.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    return undefined;
  }
  try {
    while (!signal.aborted) {
      const result = await Promise.race([reader.read(), aborted]);
      if (!result || signal.aborted) break;
      const text = result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      for (const char of text) {
        if (signal.aborted) break;
        if (afterCR && char === '\n') { afterCR = false; continue; }
        afterCR = false;
        if (char === '\r' || char === '\n') {
          afterCR = char === '\r';
          const payload = acceptLine();
          if (payload !== undefined) yield payload;
        } else line += char;
      }
      if (result.done) break;
    }
  } finally {
    signal.removeEventListener('abort', abort);
    // Cancellation settles pending reads, but an underlying cancel hook can
    // itself never settle. It must not hold the turn or leak a rejection.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

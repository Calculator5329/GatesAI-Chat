// SSE frame reader. Bytes in, `data:` payload strings out.
//
// Split out from the provider on purpose: this is the part with the buffering
// bugs (a chunk boundary in the middle of a frame), and it is testable
// without a provider, a model or a network.

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = dataPayload(frame);
        if (payload !== undefined) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const tail = dataPayload(buffer);
    if (tail !== undefined && !signal.aborted) yield tail;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function dataPayload(frame: string): string | undefined {
  const lines = frame.split('\n');
  const data: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data:')) continue;
    data.push(trimmed.slice(5).trimStart());
  }
  return data.length > 0 ? data.join('\n') : undefined;
}

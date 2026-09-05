// Test support: build a real streaming `Response` out of SSE frames, so the
// transport under test parses bytes it did not author.

export function sseResponse(frames: readonly string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

/** One OpenAI-compatible content delta, as it arrives on the wire. */
export function contentFrame(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

export function finishFrame(reason: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
}

export function usageFrame(promptTokens: number, completionTokens: number): string {
  return `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  })}\n\n`;
}

export const DONE_FRAME = 'data: [DONE]\n\n';

/** A deterministic clock and id source, so assertions are on values not shapes. */
export function fixedClock(start = 1_700_000_000_000, step = 1000) {
  let current = start;
  return {
    now(): number {
      const value = current;
      current += step;
      return value;
    },
  };
}

export function sequentialIds() {
  let counter = 0;
  return {
    next(prefix: string): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}

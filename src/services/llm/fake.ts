import type { LlmChunk, LlmProvider, LlmRequest } from '../../core/llm';

const RESPONSES: string[] = [
  `That's a good question. Here's how I'd think about it.

When you're weighing tradeoffs in system design, the boring answer is usually the right one: pick the option with the fewest moving parts, then add complexity only when measurements force you to. Premature abstraction costs more than duplication in the first six months of a project.

The corollary is that you should write the naive version first, even if you're sure it won't scale.`,

  `Good question — let me break it down.

1. **Start with the data model.** Everything else follows from the shape of your records. If the model is wrong, no amount of clever indexing saves you.
2. **Write the queries before the schema.** Knowing what you'll ask determines how you store.
3. **Benchmark with realistic volume.** 1K rows lies; 10M rows tells the truth.
4. **Add indexes reactively, not prophylactically.** Each index is a write-time cost.
5. **Separate hot and cold paths.** Archive ruthlessly.

That ordering rarely steers you wrong.`,

  `Here's a quick TypeScript sketch:

\`\`\`ts
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export async function safely<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
\`\`\`

Use \`safely\` at the boundary of your application — route handlers, queue consumers, cron jobs. Keep the inside throwing; wrap at the edges.`,

  `Here's a comparison of the options:

| Option | Latency | Cost | Complexity |
|--------|---------|------|------------|
| In-process cache | ~0.01ms | free | low |
| Redis | ~0.5ms | $ | medium |
| Memcached | ~0.3ms | $ | medium |
| CDN edge | ~10ms | $$ | high |

For most workloads, **start in-process** and graduate to Redis only when you need cross-instance coherence. The jump to a CDN is warranted only when you're serving static responses at scale.`,
];

let cursor = 0;

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class FakeProvider implements LlmProvider {
  readonly id = 'fake' as const;

  ready(): boolean { return true; }

  async *stream(_req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const text = RESPONSES[cursor++ % RESPONSES.length];
    const tokens = text.split(/(\s+)/);

    try {
      for (const token of tokens) {
        await wait(25, signal);
        yield { type: 'text', delta: token };
      }
      yield { type: 'done', finishReason: 'stop' };
    } catch {
      yield { type: 'done', finishReason: 'cancelled' };
    }
  }
}

import type { Message, Thread } from './types';
import { DEFAULT_MODEL_ID } from './models';

const WELCOME_USER = `I need to build a streaming proxy that fans out to OpenRouter. Should I keep retries client-side or put them in the proxy?`;

const WELCOME_REPLY = `Put retries in the proxy. Three reasons, from most to least important:

1. **Idempotency keys and backoff are cross-cutting.** Every client reinventing them is where inconsistent behavior comes from. A proxy owns the policy once.
2. **You can multiplex providers.** OpenRouter already does this, but if a model 429s you can fall over to a sibling (Sonnet → Haiku, GPT-5 → GPT-5 mini) without the client knowing.
3. **Streaming retries are subtle.** If the stream dies mid-response you want to *resume* from the last token boundary, not restart. That logic belongs server-side.

Keep the client thin — one retry on network error, then surface.

\`\`\`ts
// proxy/stream.ts
export async function proxyStream(req: Request) {
  const body = await req.json();
  const policy = { max: 3, backoff: 'exp', jitter: 0.2 };

  for (let attempt = 0; attempt < policy.max; attempt++) {
    try {
      const upstream = await fetch(OR_URL, {
        method: 'POST',
        headers: withIdempotencyKey(req.headers),
        body: JSON.stringify(body),
      });
      if (upstream.status === 429) {
        await wait(backoffMs(attempt, policy));
        continue;
      }
      return streamThrough(upstream);
    } catch (e) {
      if (attempt === policy.max - 1) throw e;
    }
  }
}
\`\`\`

Want me to sketch the fallback routing table next?`;

interface SeedThread {
  id: string;
  title: string;
  subtitle: string;
  pinned?: boolean;
  modelId?: string;
}

const SEED_THREADS: SeedThread[] = [
  { id: 't1',  title: 'OpenRouter gateway design', subtitle: 'Streaming proxy w/ retries — which model?', pinned: true },
  { id: 't2',  title: 'Terraform refactor plan',   subtitle: 'Split modules by env, keep remote state…', modelId: 'gpt-5.4-mini' },
  { id: 't3',  title: 'Weekly review — Apr 22',    subtitle: 'Pull commits, summarize calendar…' },
  { id: 't4',  title: 'Rust async runtime notes',  subtitle: 'Tokio vs smol tradeoffs for CLI…',          modelId: 'or-deepseek-v3.2' },
  { id: 't5',  title: 'Book: Antifragile — notes', subtitle: 'Taleb chapter 4 summary',                   modelId: 'gpt-5.4' },
  { id: 't6',  title: 'Recipe: tantanmen',         subtitle: 'Sesame paste ratio?',                       modelId: 'gemini-3-flash' },
  { id: 't7',  title: 'Apartment lease review',    subtitle: 'Redline clause 14(b)',                      modelId: 'claude-opus-4.7' },
  { id: 't8',  title: 'Flight search — Tokyo',     subtitle: 'Window seat, under $900',                   modelId: 'gpt-5.4' },
  { id: 't9',  title: 'Investor memo draft',       subtitle: 'Second pass — tighten the ask' },
  { id: 't10', title: 'Kubernetes CRD for gateway',subtitle: 'Finalize spec, add webhook',                modelId: 'gpt-5.4' },
  { id: 't11', title: 'Piano practice — Chopin Op.9', subtitle: 'Fingering for bars 12–16' },
];

export function buildSeedThreads(): Thread[] {
  const now = Date.now();
  return SEED_THREADS.map((t, idx) => {
    const created = now - (SEED_THREADS.length - idx) * 60_000;
    const isWelcome = t.id === 't1';
    return {
      id: t.id,
      title: t.title,
      subtitle: t.subtitle,
      createdAt: created,
      updatedAt: created,
      pinned: !!t.pinned,
      modelId: t.modelId ?? DEFAULT_MODEL_ID,
      messages: (isWelcome
        ? [
            { id: 'm1', role: 'user',      content: WELCOME_USER,  createdAt: created },
            { id: 'm2', role: 'assistant', content: WELCOME_REPLY, createdAt: created, model: DEFAULT_MODEL_ID },
          ]
        : []) as Message[],
    };
  });
}

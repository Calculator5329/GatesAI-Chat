// Generates a short conversation title from the opening exchange using a cheap
// model cascade. Stateless; called by ChatStore.maybeAutoName.
import type { LlmProvider, LlmRequest } from '../core/llm';

/**
 * Auto-name a thread from its opening exchange using a small, cheap model.
 *
 * Cascade (try each in order, fall through on missing key / failure):
 *
 *   1. or-gemini-3.1-flash-lite
 *   2. or-gemini-3-flash
 *   3. <thread's own model>     ← guaranteed available since it just replied
 *
 * The user picked this order. The thread's own model is the last resort:
 * if all the cheap models are missing keys, naming with the conversation
 * model is preferable to leaving "Untitled" forever.
 *
 * Output: a 2-5 word title, no punctuation, no quotes. We strip aggressively
 * because small models love to wrap titles in "" or end with "."
 */

const NAMER_CASCADE: string[] = [
  'or-gemini-3.1-flash-lite',
  'or-gemini-3-flash',
];

// A naming call is best-effort and must never hang the thread's `naming`
// indicator. If a provider stream stalls without ever yielding `done` or
// erroring, abort the attempt and fall through to the next candidate.
const NAMER_ATTEMPT_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = [
  'You name conversations. Given the first user question and the start of the assistant\'s reply, output a concise 2-5 word title that captures the topic.',
  '',
  'Rules:',
  '- Title case (e.g. "Refactoring the Auth Layer")',
  '- No quotes, no punctuation, no trailing period',
  '- 2 to 5 words, prefer 3',
  '- Skip filler words ("Help with", "Question about", "How to")',
  '- Output ONLY the title, nothing else',
].join('\n');

export interface NameThreadInput {
  userText: string;
  assistantText: string;
  fallbackModelId: string;
}

export interface ThreadTitleRouter {
  resolve(modelId: string): { provider: LlmProvider; providerModelId: string };
}

export async function generateThreadTitle(
  input: NameThreadInput,
  router: ThreadTitleRouter,
): Promise<string | null> {
  const candidates = [...NAMER_CASCADE, input.fallbackModelId];
  const userMsg = trimForPrompt(input.userText, 600);
  const aMsg = trimForPrompt(input.assistantText, 800);
  const prompt = aMsg
    ? `User asked:\n${userMsg}\n\nAssistant replied:\n${aMsg}\n\nTitle:`
    : `User asked:\n${userMsg}\n\nTitle:`;

  for (const modelId of candidates) {
    let provider: LlmProvider;
    let providerModelId: string;
    try {
      ({ provider, providerModelId } = router.resolve(modelId));
    } catch {
      continue;
    }
    if (!provider.ready()) continue;

    const request: LlmRequest = {
      modelId: providerModelId,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
    };

    const controller = new AbortController();
    try {
      const title = await withTimeout(
        collectShortReply(provider.stream(request, controller.signal)),
        NAMER_ATTEMPT_TIMEOUT_MS,
        controller,
      );
      const cleaned = sanitizeTitle(title);
      if (cleaned) return cleaned;
    } catch {
      // Fall through to next model in the cascade (includes timeouts).
    }
  }
  return null;
}

/**
 * Resolve `promise`, or reject after `ms` (aborting `controller` so a respecting
 * provider also stops its underlying fetch). Guarantees the caller settles even
 * if the stream never does.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('thread-namer attempt timed out'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function collectShortReply(stream: AsyncIterable<{ type: string; delta?: string }>): Promise<string> {
  let out = '';
  for await (const chunk of stream as AsyncIterable<{ type: string; delta?: string }>) {
    if (chunk.type === 'text' && chunk.delta) out += chunk.delta;
    if (chunk.type === 'done') break;
    // Guard against runaway responses — the namer should produce ~5 words.
    if (out.length > 200) break;
  }
  return out;
}

function sanitizeTitle(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/[.!?]+$/g, '');
  s = s.split('\n')[0].trim();
  // Squash whitespace.
  s = s.replace(/\s+/g, ' ');
  // Cap to 5 words.
  const words = s.split(' ').filter(Boolean);
  if (words.length > 5) s = words.slice(0, 5).join(' ');
  if (s.length > 60) s = s.slice(0, 60).trim();
  return s;
}

function trimForPrompt(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

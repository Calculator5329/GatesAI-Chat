// Derives follow-up suggestions from an assistant reply.
// Called by the Aurora message footer; pure and provider-free.
// Invariant: suggestions are QUOTED from the reply, never invented. If the
// assistant did not offer or ask anything, there are no follow-ups — the app
// must not put words in the model's mouth, and must not spend a turn guessing.

/** Longest suggestion that still fits a chip without wrapping to three lines. */
const MAX_LENGTH = 120;
/** Below this a "question" is noise: "Ok?", "Right?". */
const MIN_LENGTH = 12;
const MAX_SUGGESTIONS = 3;
/** Only the tail of a reply contains its closing offers. */
const TAIL_LINES = 18;

const OFFER_PREFIX = /^(want me to|should i|shall i|would you like|do you want|need me to|ready for)/i;
const QUESTION_WORD = /^(what|which|how|why|when|where|who|can|could|does|is|are|do)\b/i;

/**
 * Pulls the questions an assistant reply actually ends with, in reply order,
 * so the user can answer with one click instead of retyping the model's own
 * offer back at it.
 */
export function deriveFollowUps(reply: string): string[] {
  if (!reply.trim()) return [];
  const lines = reply.trim().split(/\r?\n/).slice(-TAIL_LINES);
  const seen = new Set<string>();
  const offers: string[] = [];
  const questions: string[] = [];

  for (const rawLine of lines) {
    const line = stripMarkdown(rawLine);
    if (!line) continue;
    for (const sentence of splitSentences(line)) {
      const candidate = sentence.trim();
      if (!candidate.endsWith('?')) continue;
      if (candidate.length < MIN_LENGTH || candidate.length > MAX_LENGTH) continue;
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (OFFER_PREFIX.test(candidate)) offers.push(candidate);
      else if (QUESTION_WORD.test(candidate)) questions.push(candidate);
    }
  }

  // A direct offer ("Want me to run it?") is the likeliest next turn, so it
  // outranks a rhetorical question earlier in the same reply.
  return [...offers, ...questions].slice(0, MAX_SUGGESTIONS);
}

/** Strips the markdown that would otherwise leak into a chip label. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(?<!\w)[*_]([^*_]+)[*_](?!\w)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** Splits on sentence ends while keeping the terminator on the sentence. */
function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

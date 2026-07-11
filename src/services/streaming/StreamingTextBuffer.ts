// Buffers streaming provider text and reveals it at a smooth, steady cadence.
// Called by ChatStore during assistant streaming; depends on a frame scheduler.
// Invariant: revealed text is emitted in order; flush()/finalization drains all
// pending text so nothing is held back at stream end.
//
// Why pace the reveal: providers deliver text in uneven bursts (some send a few
// chars at a time, others a whole sentence in one chunk). Emitting each burst
// verbatim per frame reads as jerky. Instead we hold a buffer and, each frame,
// reveal only a slice of it — so bursts spread across frames as smooth "typing".
// The slice scales with the backlog and gets an extra catch-up boost past a
// threshold. That keeps the tail calm without letting a fast model build up a
// visibly delayed wall of text.
type FlushCallback = () => void;
type ScheduleFlush = (flush: FlushCallback) => void;

interface PendingText {
  text: string;                    // received-but-not-yet-revealed buffer
  reveal: (text: string) => void;  // emit a slice (appended to the message)
  scheduled: boolean;              // is a frame tick already queued?
}

export interface StreamingTextBufferOptions {
  /** Base reveal rate before catch-up acceleration is applied. */
  revealDivisor?: number;
  minRevealChars?: number;
  /** Backlog above this size receives an additional catch-up slice. */
  catchUpThreshold?: number;
  /** Divisor for the backlog beyond `catchUpThreshold`; lower is faster. */
  catchUpDivisor?: number;
  /** Avoid a single render frame becoming too large, even for extreme bursts. */
  maxRevealChars?: number;
}

const DEFAULT_REVEAL_DIVISOR = 6;
const DEFAULT_MIN_REVEAL_CHARS = 2;
const DEFAULT_CATCH_UP_THRESHOLD = 120;
const DEFAULT_CATCH_UP_DIVISOR = 3;
const DEFAULT_MAX_REVEAL_CHARS = 256;

/**
 * Choose the next per-frame slice from the number of buffered UTF-16 code
 * units. Small backlogs use the base proportional rate. Once the buffer is
 * more than roughly a paragraph behind, the excess contributes a second,
 * steeper rate so the visible response catches the provider without making
 * the near-tip animation jumpy.
 */
export function revealCharsForBacklog(
  backlog: number,
  options: StreamingTextBufferOptions = {},
): number {
  if (!Number.isFinite(backlog) || backlog <= 0) return 0;

  const remaining = Math.floor(backlog);
  const revealDivisor = positiveInteger(options.revealDivisor, DEFAULT_REVEAL_DIVISOR);
  const minRevealChars = positiveInteger(options.minRevealChars, DEFAULT_MIN_REVEAL_CHARS);
  const catchUpThreshold = positiveInteger(options.catchUpThreshold, DEFAULT_CATCH_UP_THRESHOLD);
  const catchUpDivisor = positiveInteger(options.catchUpDivisor, DEFAULT_CATCH_UP_DIVISOR);
  const maxRevealChars = Math.max(
    minRevealChars,
    positiveInteger(options.maxRevealChars, DEFAULT_MAX_REVEAL_CHARS),
  );

  const baseCount = Math.ceil(remaining / revealDivisor);
  const excessBacklog = Math.max(0, remaining - catchUpThreshold);
  const catchUpCount = Math.ceil(excessBacklog / catchUpDivisor);
  return Math.min(remaining, maxRevealChars, Math.max(minRevealChars, baseCount + catchUpCount));
}

export class StreamingTextBuffer {
  private readonly pending = new Map<string, PendingText>();
  private readonly scheduleFlush: ScheduleFlush;
  private readonly pacing: StreamingTextBufferOptions;

  constructor(scheduleFlush: ScheduleFlush = defaultScheduleFlush, options: StreamingTextBufferOptions = {}) {
    this.scheduleFlush = scheduleFlush;
    this.pacing = { ...options };
  }

  enqueue(key: string, delta: string, reveal: (text: string) => void): void {
    if (!delta) return;
    const pending = this.pending.get(key);
    if (pending) {
      pending.text += delta;
      pending.reveal = reveal;
      this.schedule(key, pending);
      return;
    }
    const next: PendingText = { text: delta, reveal, scheduled: false };
    this.pending.set(key, next);
    this.schedule(key, next);
  }

  /** Drain all buffered text for a key immediately (stream end / finalization). */
  flush(key: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    if (pending.text) pending.reveal(pending.text);
  }

  cancel(key: string): void {
    this.pending.delete(key);
  }

  cancelAll(): void {
    this.pending.clear();
  }

  private schedule(key: string, pending: PendingText): void {
    if (pending.scheduled) return;
    pending.scheduled = true;
    this.scheduleFlush(() => this.tick(key));
  }

  private tick(key: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    pending.scheduled = false;
    const remaining = pending.text.length;
    if (remaining === 0) {
      this.pending.delete(key);
      return;
    }
    let count = revealCharsForBacklog(remaining, this.pacing);
    // Never split a surrogate pair: ending a slice on a lone high surrogate would
    // briefly render U+FFFD until the next frame. Pull in its low half too.
    if (count < remaining) {
      const lead = pending.text.charCodeAt(count - 1);
      if (lead >= 0xd800 && lead <= 0xdbff) count += 1;
    }
    pending.reveal(pending.text.slice(0, count));
    pending.text = pending.text.slice(count);
    if (pending.text.length > 0) {
      this.schedule(key, pending);
    } else {
      this.pending.delete(key);
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.floor(value));
}

function defaultScheduleFlush(flush: FlushCallback): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => flush());
    return;
  }

  globalThis.setTimeout(flush, 24);
}

// Buffers streaming provider text and reveals it at a smooth, steady cadence.
// Called by ChatStore during assistant streaming; depends on a frame scheduler.
// Invariant: revealed text is emitted in order; flush()/finalization drains all
// pending text so nothing is held back at stream end.
//
// Why pace the reveal: providers deliver text in uneven bursts (some send a few
// chars at a time, others a whole sentence in one chunk). Emitting each burst
// verbatim per frame reads as jerky. Instead we hold a buffer and, each frame,
// reveal only a slice of it — so bursts spread across frames as smooth "typing".
// The slice scales with the backlog (`ceil(remaining / revealDivisor)`), so we
// never lag behind a fast model; small tails still drain a couple chars a frame.
type FlushCallback = () => void;
type ScheduleFlush = (flush: FlushCallback) => void;

interface PendingText {
  text: string;                    // received-but-not-yet-revealed buffer
  reveal: (text: string) => void;  // emit a slice (appended to the message)
  scheduled: boolean;              // is a frame tick already queued?
}

export interface StreamingTextBufferOptions {
  /** Per-frame reveal is `clamp(ceil(remaining / revealDivisor), minRevealChars, remaining)`. */
  revealDivisor?: number;
  minRevealChars?: number;
}

const DEFAULT_REVEAL_DIVISOR = 6;
const DEFAULT_MIN_REVEAL_CHARS = 2;

export class StreamingTextBuffer {
  private readonly pending = new Map<string, PendingText>();
  private readonly scheduleFlush: ScheduleFlush;
  private readonly revealDivisor: number;
  private readonly minRevealChars: number;

  constructor(scheduleFlush: ScheduleFlush = defaultScheduleFlush, options: StreamingTextBufferOptions = {}) {
    this.scheduleFlush = scheduleFlush;
    this.revealDivisor = Math.max(1, options.revealDivisor ?? DEFAULT_REVEAL_DIVISOR);
    this.minRevealChars = Math.max(1, options.minRevealChars ?? DEFAULT_MIN_REVEAL_CHARS);
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
    let count = Math.min(remaining, Math.max(this.minRevealChars, Math.ceil(remaining / this.revealDivisor)));
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

function defaultScheduleFlush(flush: FlushCallback): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => flush());
    return;
  }

  globalThis.setTimeout(flush, 24);
}

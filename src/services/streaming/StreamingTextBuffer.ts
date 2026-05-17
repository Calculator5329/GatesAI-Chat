type FlushCallback = () => void;
type ScheduleFlush = (flush: FlushCallback) => void;

interface PendingText {
  text: string;
  flush: (text: string) => void;
}

export class StreamingTextBuffer {
  private readonly pending = new Map<string, PendingText>();
  private readonly scheduleFlush: ScheduleFlush;
  private readonly maxPendingChars: number;

  constructor(scheduleFlush: ScheduleFlush = defaultScheduleFlush, maxPendingChars = 72) {
    this.scheduleFlush = scheduleFlush;
    this.maxPendingChars = maxPendingChars;
  }

  enqueue(key: string, delta: string, flush: (text: string) => void): void {
    if (!delta) return;
    const pending = this.pending.get(key);
    if (pending) {
      pending.text += delta;
      pending.flush = flush;
      if (pending.text.length >= this.maxPendingChars) this.flush(key);
      return;
    }

    this.pending.set(key, { text: delta, flush });
    if (delta.length >= this.maxPendingChars) {
      this.flush(key);
      return;
    }
    this.scheduleFlush(() => this.flush(key));
  }

  flush(key: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    pending.flush(pending.text);
  }

  cancel(key: string): void {
    this.pending.delete(key);
  }

  cancelAll(): void {
    this.pending.clear();
  }
}

function defaultScheduleFlush(flush: FlushCallback): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => flush());
    return;
  }

  globalThis.setTimeout(flush, 24);
}

import { describe, expect, it } from 'vitest';
import { StreamingTextBuffer } from '../../src/services/streaming/StreamingTextBuffer';

// Run every scheduled tick, including ones rescheduled while draining. An index
// loop re-reads `.length` each iteration (unlike `forEach`, which snapshots it),
// so it also runs ticks appended as the buffer drains.
function drain(scheduled: Array<() => void>): void {
  for (let i = 0; i < scheduled.length; i++) scheduled[i]();
}

describe('StreamingTextBuffer', () => {
  it('coalesces deltas and reveals them progressively, not all at once', () => {
    const scheduled: Array<() => void> = [];
    const revealed: string[] = [];
    const buffer = new StreamingTextBuffer(flush => scheduled.push(flush), { revealDivisor: 2, minRevealChars: 1 });

    buffer.enqueue('m', 'Hel', text => revealed.push(text));
    buffer.enqueue('m', 'lo', text => revealed.push(text));

    // Nothing emitted synchronously; the two deltas share a single queued tick.
    expect(revealed).toEqual([]);
    expect(scheduled).toHaveLength(1);

    drain(scheduled);

    expect(revealed.join('')).toBe('Hello');     // every char arrives, in order
    expect(revealed.length).toBeGreaterThan(1);  // ...spread over multiple frames
  });

  it('flush drains all pending text at once; cancel discards it', () => {
    const scheduled: Array<() => void> = [];
    const revealed: string[] = [];
    const buffer = new StreamingTextBuffer(flush => scheduled.push(flush));

    buffer.enqueue('m1', 'final answer', text => revealed.push(text));
    buffer.flush('m1');
    buffer.enqueue('m2', 'discarded', text => revealed.push(text));
    buffer.cancel('m2');
    drain(scheduled); // queued ticks find their entries gone and no-op

    expect(revealed).toEqual(['final answer']);
  });

  it('reveals a large burst over several frames instead of dumping it', () => {
    const scheduled: Array<() => void> = [];
    const revealed: string[] = [];
    const buffer = new StreamingTextBuffer(flush => scheduled.push(flush), { revealDivisor: 6, minRevealChars: 2 });

    const burst = 'x'.repeat(120);
    buffer.enqueue('m', burst, text => revealed.push(text));

    scheduled[0]();
    expect(revealed[0]).toHaveLength(20);            // ceil(120 / 6), not the whole burst
    expect(revealed[0]!.length).toBeLessThan(burst.length);

    drain(scheduled);
    expect(revealed.join('')).toBe(burst);
  });
});

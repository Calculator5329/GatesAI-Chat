import { describe, expect, it } from 'vitest';
import { StreamingTextBuffer } from '../../src/services/streaming/StreamingTextBuffer';

describe('StreamingTextBuffer', () => {
  it('coalesces multiple deltas into one scheduled flush per key', () => {
    const scheduled: Array<() => void> = [];
    const flushed: string[] = [];
    const buffer = new StreamingTextBuffer((flush) => scheduled.push(flush));

    buffer.enqueue('message-1', 'Hel', text => flushed.push(text));
    buffer.enqueue('message-1', 'lo', text => flushed.push(text));

    expect(flushed).toEqual([]);
    expect(scheduled).toHaveLength(1);

    scheduled[0]();

    expect(flushed).toEqual(['Hello']);
  });

  it('can flush or cancel a pending message immediately', () => {
    const scheduled: Array<() => void> = [];
    const flushed: string[] = [];
    const buffer = new StreamingTextBuffer((flush) => scheduled.push(flush));

    buffer.enqueue('message-1', 'final', text => flushed.push(text));
    buffer.flush('message-1');
    buffer.enqueue('message-2', 'discarded', text => flushed.push(text));
    buffer.cancel('message-2');
    scheduled.forEach(flush => flush());

    expect(flushed).toEqual(['final']);
  });

  it('flushes immediately when pending text grows past the threshold', () => {
    const scheduled: Array<() => void> = [];
    const flushed: string[] = [];
    const buffer = new StreamingTextBuffer((flush) => scheduled.push(flush), 6);

    buffer.enqueue('message-1', 'abc', text => flushed.push(text));
    buffer.enqueue('message-1', 'def', text => flushed.push(text));

    expect(flushed).toEqual(['abcdef']);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(flushed).toEqual(['abcdef']);
  });
});

import { describe, expect, it } from 'vitest';
import { isNearScrollBottom, shouldDisengageScrollFollow, pinScrollToBottom, resolveScrollFollow, readerScrolledUpSinceLastPin } from '../../../src/components/editorial/scrollFollow';

const overflowing = { scrollHeight: 1_000, scrollTop: 600, clientHeight: 300 };

describe('scroll follow state', () => {
  it('treats the tolerance band as the bottom and re-engages there', () => {
    expect(isNearScrollBottom(overflowing, 100)).toBe(true);
    expect(isNearScrollBottom({ ...overflowing, scrollTop: 599 }, 100)).toBe(false);
    expect(isNearScrollBottom({ ...overflowing, scrollTop: 700 }, 100)).toBe(true);
  });

  it('disengages immediately on upward wheel intent', () => {
    expect(shouldDisengageScrollFollow(true, -1, overflowing)).toBe(true);
    expect(shouldDisengageScrollFollow(true, 1, overflowing)).toBe(false);
    expect(shouldDisengageScrollFollow(false, -1, overflowing)).toBe(false);
  });

  it('does not disengage when the timeline cannot scroll', () => {
    expect(shouldDisengageScrollFollow(true, -20, {
      scrollHeight: 300,
      scrollTop: 0,
      clientHeight: 300,
    })).toBe(false);
  });
});

describe('pinScrollToBottom', () => {
  it('reports true only when the write moves the scroller', () => {
    const el = { scrollTop: 0, scrollHeight: 500 };
    expect(pinScrollToBottom(el)).toBe(true);
    expect(el.scrollTop).toBe(500);
    // Already pinned: the browser fires no scroll event for this write, so no
    // programmatic credit may be banked for it.
    expect(pinScrollToBottom(el)).toBe(false);
  });
});

describe('resolveScrollFollow', () => {
  const away = { scrollHeight: 10000, scrollTop: 2000, clientHeight: 700 };
  const bottom = { scrollHeight: 10000, scrollTop: 9300, clientHeight: 700 };

  it('leaves follow on a genuine reader scroll away from the bottom', () => {
    expect(resolveScrollFollow(true, false, away, 100)).toBe('leave');
  });

  it('never changes state for the scroll event our own pin produced', () => {
    expect(resolveScrollFollow(true, true, away, 100)).toBe('keep');
    expect(resolveScrollFollow(false, true, bottom, 100)).toBe('keep');
  });

  it('rejoins only at the true bottom, not within the leave tolerance', () => {
    const nearly = { scrollHeight: 10000, scrollTop: 9250, clientHeight: 700 };
    expect(resolveScrollFollow(false, false, nearly, 100)).toBe('keep');
    expect(resolveScrollFollow(false, false, bottom, 100)).toBe('rejoin');
    expect(resolveScrollFollow(true, false, nearly, 100)).toBe('keep');
  });
});

describe('readerScrolledUpSinceLastPin', () => {
  it('is false before the first pin has been recorded', () => {
    expect(readerScrolledUpSinceLastPin(-1, { scrollHeight: 5000, scrollTop: 100, clientHeight: 600 })).toBe(false);
  });

  it('is false when layout growth left scrollTop where the pin put it', () => {
    expect(readerScrolledUpSinceLastPin(4400, { scrollHeight: 5600, scrollTop: 4400, clientHeight: 600 })).toBe(false);
  });

  it('is false when layout shrink clamped scrollTop to a lower bottom', () => {
    expect(readerScrolledUpSinceLastPin(4400, { scrollHeight: 4600, scrollTop: 4000, clientHeight: 600 })).toBe(false);
  });

  it('is true when the scroller moved up and is no longer at the bottom', () => {
    expect(readerScrolledUpSinceLastPin(4400, { scrollHeight: 5000, scrollTop: 1200, clientHeight: 600 })).toBe(true);
  });
});

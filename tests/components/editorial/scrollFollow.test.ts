import { describe, expect, it } from 'vitest';
import { isNearScrollBottom, shouldDisengageScrollFollow } from '../../../src/components/editorial/scrollFollow';

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

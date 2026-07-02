import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_PLACEHOLDER_HEIGHT,
  edgeRenderedMessageIds,
  nextMeasuredMessageHeights,
  normalizedMessageHeight,
  placeholderHeightForMessage,
  shouldRenderFullMessage,
  streamingNeighborMessageIds,
} from '../../../src/components/editorial/messageWindowing';

describe('messageWindowing height cache', () => {
  it('normalizes measured heights for stable placeholders', () => {
    expect(normalizedMessageHeight(123.1)).toBe(124);
    expect(normalizedMessageHeight(0)).toBeNull();
    expect(normalizedMessageHeight(Number.NaN)).toBeNull();
  });

  it('returns the same cache when a measurement cannot improve it', () => {
    const initial = new Map([['m-1', 140]]);

    expect(nextMeasuredMessageHeights(initial, 'm-1', 140)).toBe(initial);
    expect(nextMeasuredMessageHeights(initial, 'm-2', -1)).toBe(initial);
  });

  it('stores measured heights by message id and falls back for unknown rows', () => {
    const initial = new Map<string, number>();
    const next = nextMeasuredMessageHeights(initial, 'm-1', 201.2);

    expect(next).not.toBe(initial);
    expect(placeholderHeightForMessage(next, 'm-1')).toBe(202);
    expect(placeholderHeightForMessage(next, 'm-2')).toBe(DEFAULT_MESSAGE_PLACEHOLDER_HEIGHT);
  });
});

describe('messageWindowing render decisions', () => {
  it('renders every message when IntersectionObserver is unavailable', () => {
    expect(shouldRenderFullMessage({
      windowingSupported: false,
      nearViewport: false,
      edgeRendered: false,
      streamingNeighbor: false,
    })).toBe(true);
  });

  it('keeps streaming messages and their neighbors fully rendered', () => {
    const ids = ['m-0', 'm-1', 'm-2', 'm-3', 'm-4'];

    expect([...streamingNeighborMessageIds(ids, 'm-2')]).toEqual(['m-1', 'm-2', 'm-3']);
    expect(shouldRenderFullMessage({
      windowingSupported: true,
      nearViewport: false,
      edgeRendered: false,
      streamingNeighbor: true,
    })).toBe(true);
  });

  it('seeds both list edges so first paint and pagination have real rows', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `m-${index}`);

    expect([...edgeRenderedMessageIds(ids, 2)]).toEqual(['m-0', 'm-1', 'm-18', 'm-19']);
  });
});

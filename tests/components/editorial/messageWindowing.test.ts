import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_PLACEHOLDER_HEIGHT,
  computeVisibleMessageRange,
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
  it('computes a half-open visible range with pixel overscan', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const heights = new Map(ids.map(id => [id, 100]));

    expect(computeVisibleMessageRange({
      messageIds: ids,
      heights,
      scrollTop: 150,
      viewportHeight: 100,
      overscanPx: 50,
    })).toEqual({ start: 1, end: 3 });
  });

  it('uses placeholder heights and clamps invalid viewport inputs', () => {
    expect(computeVisibleMessageRange({
      messageIds: ['a', 'b', 'c'],
      heights: new Map([['a', 50]]),
      scrollTop: Number.NaN,
      viewportHeight: -20,
      overscanPx: 60,
    })).toEqual({ start: 0, end: 2 });
    expect(computeVisibleMessageRange({
      messageIds: [], heights: new Map(), scrollTop: 0, viewportHeight: 100,
    })).toEqual({ start: 0, end: 0 });
  });

  it('renders every message when row measurement is unavailable', () => {
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

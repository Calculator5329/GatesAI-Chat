export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** A small tolerance keeps late-loading media and fractional pixels from flapping follow state. */
export function isNearScrollBottom(metrics: ScrollMetrics, tolerance: number): boolean {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distance <= tolerance;
}

/** Upward wheel intent disengages before the browser's subsequent scroll event. */
export function shouldDisengageScrollFollow(
  following: boolean,
  deltaY: number,
  metrics: ScrollMetrics,
): boolean {
  return following && deltaY < 0 && metrics.scrollHeight > metrics.clientHeight;
}

/**
 * Pin the scroller to its bottom and report whether the write moved it. A
 * scroll event only fires when scrollTop actually changes, so callers must
 * count a programmatic credit only when this returns true; counting a no-op
 * write leaves a phantom credit that later swallows a real reader scroll
 * (scrollbar drag, keyboard, touch) as "programmatic".
 */
export function pinScrollToBottom(el: { scrollTop: number; scrollHeight: number }): boolean {
  const before = el.scrollTop;
  el.scrollTop = el.scrollHeight;
  return el.scrollTop !== before;
}

export type ScrollFollowTransition = 'leave' | 'rejoin' | 'keep';

/**
 * Decide what a scroll event does to follow state. Tolerances are asymmetric
 * on purpose: leaving follow is generous (`leaveTolerance`) so images loading
 * or trailing whitespace never trap the reader, but re-engaging demands a
 * deliberate return to the true bottom so one scroll-up near the bottom is
 * not instantly undone. A programmatic event (our own pin) never changes
 * state either way.
 */
export function resolveScrollFollow(
  following: boolean,
  programmatic: boolean,
  metrics: ScrollMetrics,
  leaveTolerance: number,
): ScrollFollowTransition {
  if (programmatic) return 'keep';
  if (following) return isNearScrollBottom(metrics, leaveTolerance) ? 'keep' : 'leave';
  return isNearScrollBottom(metrics, 2) ? 'rejoin' : 'keep';
}

/**
 * Between two settle frames the scroller can only move up for one reason:
 * the reader (a wheel, a scrollbar drag, a hover that scrolls into view).
 * Layout growth leaves scrollTop where it was and layout shrink clamps it
 * to the bottom, so "moved up and no longer at the bottom" is reader intent
 * and the settle loop must stop re-pinning.
 */
export function readerScrolledUpSinceLastPin(lastPinnedTop: number, metrics: ScrollMetrics): boolean {
  if (lastPinnedTop < 0) return false;
  if (metrics.scrollTop >= lastPinnedTop - 1) return false;
  return !isNearScrollBottom(metrics, 1);
}

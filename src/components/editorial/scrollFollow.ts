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

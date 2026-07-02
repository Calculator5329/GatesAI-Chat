export const MESSAGE_WINDOW_ROOT_MARGIN = '200% 0px';
export const DEFAULT_MESSAGE_PLACEHOLDER_HEIGHT = 200;
export const MESSAGE_WINDOW_EDGE_RENDER_COUNT = 8;

export function hasMessageWindowingSupport(): boolean {
  return typeof IntersectionObserver === 'function';
}

export function normalizedMessageHeight(height: number): number | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  return Math.ceil(height);
}

export function nextMeasuredMessageHeights(
  current: ReadonlyMap<string, number>,
  messageId: string,
  measuredHeight: number,
): ReadonlyMap<string, number> {
  const normalized = normalizedMessageHeight(measuredHeight);
  if (normalized === null || current.get(messageId) === normalized) return current;
  const next = new Map(current);
  next.set(messageId, normalized);
  return next;
}

export function placeholderHeightForMessage(
  heights: ReadonlyMap<string, number>,
  messageId: string,
): number {
  return heights.get(messageId) ?? DEFAULT_MESSAGE_PLACEHOLDER_HEIGHT;
}

export function edgeRenderedMessageIds(
  messageIds: readonly string[],
  edgeCount = MESSAGE_WINDOW_EDGE_RENDER_COUNT,
): Set<string> {
  if (edgeCount <= 0 || messageIds.length === 0) return new Set();
  const ids = new Set<string>();
  for (let i = 0; i < Math.min(edgeCount, messageIds.length); i += 1) {
    ids.add(messageIds[i]);
  }
  for (let i = Math.max(0, messageIds.length - edgeCount); i < messageIds.length; i += 1) {
    ids.add(messageIds[i]);
  }
  return ids;
}

export function streamingNeighborMessageIds(
  messageIds: readonly string[],
  streamingId: string | null | undefined,
  radius = 1,
): Set<string> {
  if (!streamingId) return new Set();
  const index = messageIds.indexOf(streamingId);
  if (index === -1) return new Set();
  const ids = new Set<string>();
  for (let i = Math.max(0, index - radius); i <= Math.min(messageIds.length - 1, index + radius); i += 1) {
    ids.add(messageIds[i]);
  }
  return ids;
}

export function shouldRenderFullMessage(options: {
  windowingSupported: boolean;
  nearViewport: boolean;
  edgeRendered: boolean;
  streamingNeighbor: boolean;
}): boolean {
  return !options.windowingSupported
    || options.nearViewport
    || options.edgeRendered
    || options.streamingNeighbor;
}

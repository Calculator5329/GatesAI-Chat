import type { MenuSectionKey } from '../core/types';

const MENU_SECTIONS: MenuSectionKey[] = ['profile', 'agent', 'workspace', 'settings', 'usage', 'local', 'api', 'appearance'];

export type Route =
  | { kind: 'thread'; threadId: string | null }
  | { kind: 'menu';   section: MenuSectionKey };

export const DEFAULT_ROUTE: Route = { kind: 'thread', threadId: null };

/** Parse `#/thread/<id>` or `#/menu/<section>`. Anything else → default. */
export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '');
  if (!cleaned) return DEFAULT_ROUTE;
  const [head, ...rest] = cleaned.split('/');
  if (head === 'thread') {
    const id = rest.join('/') || null;
    return { kind: 'thread', threadId: id };
  }
  if (head === 'menu') {
    const section = (rest[0] ?? 'profile') as MenuSectionKey;
    return { kind: 'menu', section: MENU_SECTIONS.includes(section) ? section : 'profile' };
  }
  return DEFAULT_ROUTE;
}

export function formatHash(route: Route): string {
  switch (route.kind) {
    case 'thread': return route.threadId ? `#/thread/${route.threadId}` : '#/';
    case 'menu':   return `#/menu/${route.section}`;
  }
}

/** Side-effecting helpers that read/write `window.location.hash`. */
export function readRoute(): Route {
  return parseHash(typeof window === 'undefined' ? '' : window.location.hash);
}

export function writeRoute(route: Route): void {
  if (typeof window === 'undefined') return;
  const next = formatHash(route);
  if (window.location.hash !== next) window.location.hash = next;
}

export function subscribeRoute(listener: (route: Route) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (): void => listener(readRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

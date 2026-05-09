import type { MenuSectionKey } from '../core/types';

const DEFAULT_MENU_SECTION: MenuSectionKey = 'settings';
const MENU_SECTIONS: MenuSectionKey[] = ['agent', 'models', 'local', 'workspace', 'gallery', 'settings'];
const LEGACY_MENU_SECTIONS: Record<string, MenuSectionKey> = {
  profile: 'agent',
  api: 'models',
  usage: 'settings',
  appearance: 'settings',
};

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
    const raw = rest[0] ?? DEFAULT_MENU_SECTION;
    const section = raw as MenuSectionKey;
    if (MENU_SECTIONS.includes(section)) return { kind: 'menu', section };
    return { kind: 'menu', section: LEGACY_MENU_SECTIONS[raw] ?? DEFAULT_MENU_SECTION };
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

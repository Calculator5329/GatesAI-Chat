// Persists or coordinates service-level state for router.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import type { MenuSectionKey } from '../core/types';
import { isWebLite } from '../core/runtime';

const DEFAULT_MENU_SECTION: MenuSectionKey = 'settings';
const MENU_SECTIONS: MenuSectionKey[] = ['agent', 'models', 'settings'];

/**
 * Web Lite has no Models tab: the OpenRouter and Brave keys live in Settings
 * there, so every `models` destination (legacy hashes, banners, the palette)
 * resolves to `settings` in the browser build.
 */
export function resolveMenuSection(section: MenuSectionKey): MenuSectionKey {
  if (section === 'models' && isWebLite()) return 'settings';
  return section;
}
const LEGACY_MENU_SECTIONS: Record<string, MenuSectionKey> = {
  profile: 'agent',
  api: 'models',
  appearance: 'settings',
  // Retired tabs from the 7-tab menu (2026-07 trim): route to the nearest home.
  local: 'models',
  usage: 'settings',
  workspace: 'settings',
  gallery: 'settings',
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
    if (MENU_SECTIONS.includes(section)) return { kind: 'menu', section: resolveMenuSection(section) };
    return { kind: 'menu', section: resolveMenuSection(LEGACY_MENU_SECTIONS[raw] ?? DEFAULT_MENU_SECTION) };
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

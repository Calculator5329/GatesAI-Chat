// Owns observable RouterStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { makeAutoObservable, runInAction } from 'mobx';
import type { MenuSectionKey } from '../core/types';
import {
  type Route,
  formatHash,
  readRoute,
  subscribeRoute,
  writeRoute,
} from '../services/router';

/**
 * Two-way bound to `window.location.hash`. UI should read `route` reactively
 * and call `goThread` / `goMenu` instead of mutating the hash directly.
 */
export class RouterStore {
  route: Route;
  private dispose: (() => void) | null = null;

  constructor() {
    this.route = readRoute();
    makeAutoObservable<this, 'dispose'>(this, { dispose: false });
    this.dispose = subscribeRoute(next => {
      runInAction(() => { this.route = next; });
    });
  }

  goThread(threadId: string | null): void {
    if (this.route.kind === 'thread' && this.route.threadId === threadId) return;
    const next: Route = { kind: 'thread', threadId };
    this.route = next;
    writeRoute(next);
  }

  goMenu(section: MenuSectionKey = 'settings'): void {
    if (this.route.kind === 'menu' && this.route.section === section) return;
    const next: Route = { kind: 'menu', section };
    this.route = next;
    writeRoute(next);
  }

  /**
   * Full href for a thread route, suitable for an `<a href>` so middle-click
   * and Ctrl/Cmd-click open the thread the way users expect. Keeps hash
   * formatting behind the store facade so UI never imports services/router.
   */
  hrefForThread(threadId: string | null): string {
    const hash = formatHash({ kind: 'thread', threadId });
    if (typeof window === 'undefined') return hash;
    const url = new URL(window.location.href);
    url.hash = hash;
    return url.toString();
  }

  get isMenu(): boolean { return this.route.kind === 'menu'; }
  get menuSection(): MenuSectionKey {
    return this.route.kind === 'menu' ? this.route.section : 'settings';
  }
  get threadId(): string | null {
    return this.route.kind === 'thread' ? this.route.threadId : null;
  }

  destroy(): void {
    this.dispose?.();
    this.dispose = null;
  }
}

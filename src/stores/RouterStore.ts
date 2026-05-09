import { makeAutoObservable, runInAction } from 'mobx';
import type { MenuSectionKey } from '../core/types';
import {
  type Route,
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

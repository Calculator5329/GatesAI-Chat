// Owns observable auto-update state: available version, install progress.
// Called by RootStore (boot check) and the UpdatePill; depends on the
// appUpdater service. Web Lite: checkOnBoot is a no-op (service gates).
import { makeAutoObservable, runInAction } from 'mobx';
import {
  checkForUpdate,
  relaunchApp,
  type AvailableUpdate,
} from '../services/updates/appUpdater';
import { logger } from '../services/diagnostics/logger';

export type UpdatePhase = 'idle' | 'available' | 'installing' | 'ready' | 'error';

export interface UpdateStoreDeps {
  /** Injectable for tests; default to the real service. */
  check?: typeof checkForUpdate;
  relaunch?: typeof relaunchApp;
}

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class UpdateStore {
  phase: UpdatePhase = 'idle';
  version: string | null = null;
  notes: string | null = null;
  /** 0..1 while installing, when the payload size is known. */
  progress: number | null = null;
  error: string | null = null;
  dismissed = false;

  private update: AvailableUpdate | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: UpdateStoreDeps;

  constructor(deps: UpdateStoreDeps = {}) {
    this.deps = deps;
    makeAutoObservable<this, 'update' | 'timer' | 'deps'>(this, {
      update: false,
      timer: false,
      deps: false,
    });
  }

  /** True when the pill should render. */
  get visible(): boolean {
    return !this.dismissed && (this.phase === 'available' || this.phase === 'installing' || this.phase === 'ready' || this.phase === 'error');
  }

  /** Boot entry point: check now, then periodically. Desktop-gated inside. */
  startBackgroundChecks(): void {
    void this.checkNow();
    this.timer ??= setInterval(() => { void this.checkNow(); }, RECHECK_INTERVAL_MS);
  }

  stopBackgroundChecks(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow(): Promise<void> {
    // Don't clobber an install in flight or a staged update.
    if (this.phase === 'installing' || this.phase === 'ready') return;
    const found = await (this.deps.check ?? checkForUpdate)();
    if (!found) return;
    this.update = found;
    runInAction(() => {
      this.phase = 'available';
      this.version = found.version;
      this.notes = found.notes ?? null;
      this.dismissed = false;
      this.error = null;
    });
  }

  /** Download + stage the update, then offer restart. */
  async install(): Promise<void> {
    const update = this.update;
    if (!update || this.phase === 'installing') return;
    runInAction(() => { this.phase = 'installing'; this.progress = null; });
    try {
      await update.install((downloaded, total) => {
        runInAction(() => {
          this.progress = total ? Math.min(1, downloaded / total) : null;
        });
      });
      runInAction(() => { this.phase = 'ready'; this.progress = 1; });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error('updates', `update install failed: ${reason}`, { version: this.version });
      runInAction(() => { this.phase = 'error'; this.error = reason; });
    }
  }

  async restart(): Promise<void> {
    if (this.phase !== 'ready') return;
    await (this.deps.relaunch ?? relaunchApp)();
  }

  dismiss(): void {
    this.dismissed = true;
  }
}

// Owns observable dock layout state (right panel column) and its actions.
// Called by RootStore, React context hooks, and dock components; persists
// through services/storage/dockStorage like UiStore persists ui-prefs.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, toJS } from 'mobx';
import {
  DOCK_SNAPSHOT_VERSION,
  clampDockRatio,
  clampSplitRatio,
  dockPanelKindForPath,
  type DockCells,
  type DockPanelKind,
  type DockPanelRef,
  type DockSnapshot,
} from '../core/dock';
import { runtimeMode, type GatesRuntimeMode } from '../core/runtime';
import { loadDockSnapshot, saveDockSnapshot } from '../services/storage/dockStorage';

const PERSIST_DEBOUNCE_MS = 300;

/**
 * Layout state for the right dock: one column with up to two stacked panel
 * cells, a collapsible rail, and persisted split/width ratios. Panel content
 * loading stays in the panels themselves (through store facades); this store
 * only owns which panels are open and how the column is sized.
 */
export class DockStore {
  cells: DockCells = [null, null];
  splitRatio: number;
  dockRatio: number;
  collapsed: boolean;

  private readonly runtime: GatesRuntimeMode;
  private readonly disposers: Array<() => void> = [];

  constructor(options: { runtime?: GatesRuntimeMode } = {}) {
    this.runtime = options.runtime ?? runtimeMode();
    const snapshot = loadDockSnapshot();
    this.cells = snapshot.cells;
    this.splitRatio = snapshot.splitRatio;
    this.dockRatio = snapshot.dockRatio;
    this.collapsed = snapshot.collapsed;
    makeAutoObservable<this, 'runtime' | 'disposers'>(this, {
      runtime: false,
      disposers: false,
    });

    // Debounced persistence (resizer drags fire many mutations per second);
    // flushed on dispose and page hide so the final value isn't lost.
    let pending: DockSnapshot | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending) {
        saveDockSnapshot(pending);
        pending = null;
      }
    };
    this.disposers.push(autorun(() => {
      pending = toJS(this.snapshot);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    }));
    this.disposers.push(flush);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
      this.disposers.push(() => {
        window.removeEventListener('pagehide', flush);
        window.removeEventListener('beforeunload', flush);
      });
    }
  }

  dispose(): void {
    while (this.disposers.length > 0) this.disposers.pop()?.();
  }

  /**
   * Whether dock panels can exist at all in this runtime. The v1 panels
   * read workspace files through the bridge, which Web Lite doesn't have,
   * so the dock (and its entry points) hide there entirely.
   */
  get available(): boolean {
    return this.runtime === 'desktop';
  }

  get hasOpenPanels(): boolean {
    return this.cells.some(cell => cell !== null);
  }

  get openCellCount(): number {
    return this.cells.filter(cell => cell !== null).length;
  }

  get snapshot(): DockSnapshot {
    return {
      version: DOCK_SNAPSHOT_VERSION,
      cells: [this.cells[0], this.cells[1]],
      splitRatio: this.splitRatio,
      dockRatio: this.dockRatio,
      collapsed: this.collapsed,
    };
  }

  /**
   * Open a panel. Defaults to the first empty cell; when both cells are
   * occupied, replaces cell 0. Opening always un-collapses the dock so the
   * result is visible.
   */
  openPanel(kind: DockPanelKind, params: DockPanelRef['params'] = {}, cell?: 0 | 1): void {
    if (!this.available) return;
    const target = cell ?? (this.cells[0] === null ? 0 : this.cells[1] === null ? 1 : 0);
    this.cells[target] = { kind, params: { ...params } };
    this.collapsed = false;
  }

  /** Convenience entry point: route a workspace path to the right panel kind. */
  openPath(path: string, cell?: 0 | 1): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    this.openPanel(dockPanelKindForPath(trimmed), { path: trimmed }, cell);
  }

  closeCell(index: 0 | 1): void {
    this.cells[index] = null;
    // Keep the single remaining panel in cell 0 so the layout stays simple.
    if (index === 0 && this.cells[1] !== null) {
      this.cells[0] = this.cells[1];
      this.cells[1] = null;
    }
  }

  swapCells(): void {
    const [first, second] = this.cells;
    this.cells[0] = second;
    this.cells[1] = first;
  }

  setCollapsed(value: boolean): void {
    this.collapsed = value;
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
  }

  setSplitRatio(value: number): void {
    this.splitRatio = clampSplitRatio(value);
  }

  setDockRatio(value: number): void {
    this.dockRatio = clampDockRatio(value);
  }
}

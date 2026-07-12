// Persistence slot for the right dock's layout snapshot (W-1).
// Same pattern as uiPrefsStorage: a versioned JSON blob in localStorage,
// validated field-by-field on load so a corrupt snapshot degrades to defaults.
import {
  DEFAULT_DOCK_SNAPSHOT,
  DOCK_SNAPSHOT_VERSION,
  clampDockRatio,
  clampSplitRatio,
  isDockPanelKind,
  type DockCells,
  type DockPanelRef,
  type DockSnapshot,
} from '../../core/dock';
import { createJsonPersistenceProvider } from './persistenceProvider';

const KEY = 'gatesai.dock.v1';

function parseCell(value: unknown): DockPanelRef | null {
  if (!value || typeof value !== 'object') return null;
  const cell = value as Partial<DockPanelRef>;
  if (!isDockPanelKind(cell.kind)) return null;
  const params = cell.params && typeof cell.params === 'object' ? cell.params : {};
  const path = (params as { path?: unknown }).path;
  return {
    kind: cell.kind,
    params: typeof path === 'string' && path.length > 0 ? { path } : {},
  };
}

export const dockPersistence = createJsonPersistenceProvider<DockSnapshot>({
  key: KEY,
  parse: raw => {
    const parsed = raw && typeof raw === 'object' ? raw as Partial<DockSnapshot> : {};
    if (parsed.version !== DOCK_SNAPSHOT_VERSION) return { ...DEFAULT_DOCK_SNAPSHOT, cells: [null, null] };
    const rawCells = Array.isArray(parsed.cells) ? parsed.cells : [];
    const cells: DockCells = [parseCell(rawCells[0]), parseCell(rawCells[1])];
    return {
      version: DOCK_SNAPSHOT_VERSION,
      cells,
      splitRatio: typeof parsed.splitRatio === 'number'
        ? clampSplitRatio(parsed.splitRatio)
        : DEFAULT_DOCK_SNAPSHOT.splitRatio,
      dockRatio: typeof parsed.dockRatio === 'number'
        ? clampDockRatio(parsed.dockRatio)
        : DEFAULT_DOCK_SNAPSHOT.dockRatio,
      collapsed: typeof parsed.collapsed === 'boolean'
        ? parsed.collapsed
        : DEFAULT_DOCK_SNAPSHOT.collapsed,
    };
  },
});

export function loadDockSnapshot(): DockSnapshot {
  return dockPersistence.load();
}

export function saveDockSnapshot(snapshot: DockSnapshot): void {
  dockPersistence.save({ ...snapshot, version: DOCK_SNAPSHOT_VERSION });
}

export function clearDockSnapshot(): void {
  dockPersistence.clear();
}

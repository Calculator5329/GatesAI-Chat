// The right dock column shell: renders to the right of the chat/menu surface
// on desktop widths, hosting up to two stacked panel cells from the registry.
// Layout state (cells, ratios, collapsed) lives in DockStore; this component
// is presentation + pointer plumbing only. Hidden entirely on the mobile
// shell and on Web Lite (DockStore.available).
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { observer } from 'mobx-react-lite';
import type { DockPanelRef } from '../../core/dock';
import { useDockStore, useUiStore } from '../../stores/context';
import { Icons } from '../ui/icons';
import { dockCellTitle, getDockPanelDefinition } from './panelRegistry';

export const DockPanel = observer(function DockPanel() {
  const dock = useDockStore();
  const ui = useUiStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const onResizerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startRatio = dock.dockRatio;
    // Resize relative to the dock's parent (the app shell row).
    const parentWidth = containerRef.current?.parentElement?.getBoundingClientRect().width
      ?? window.innerWidth;
    const onMove = (move: PointerEvent): void => {
      const deltaPx = startX - move.clientX; // dragging left grows the dock
      dock.setDockRatio(startRatio + deltaPx / Math.max(1, parentWidth));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [dock]);

  const onDividerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const host = containerRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const onMove = (move: PointerEvent): void => {
      if (rect.height <= 0) return;
      dock.setSplitRatio((move.clientY - rect.top) / rect.height);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [dock]);

  if (!dock.available || ui.mobileShell || !dock.hasOpenPanels) return null;

  if (dock.collapsed) {
    return (
      <div className="dock-panel dock-panel--collapsed" data-testid="dock-collapsed-rail">
        <button
          type="button"
          className="dock-panel__reopen"
          title="Expand dock"
          aria-label="Expand dock"
          onClick={() => dock.setCollapsed(false)}
        >
          <span aria-hidden="true"><Icons.Back /></span>
        </button>
      </div>
    );
  }

  const occupied = dock.cells
    .map((cell, index) => ({ cell, index: index as 0 | 1 }))
    .filter((entry): entry is { cell: DockPanelRef; index: 0 | 1 } => entry.cell !== null);
  const bothOccupied = occupied.length === 2;

  return (
    <div
      className="dock-panel"
      data-testid="dock-panel"
      style={{ width: `${Math.round(dock.dockRatio * 1000) / 10}%` }}
    >
      <div
        className="dock-panel__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize dock"
        onPointerDown={onResizerPointerDown}
      />
      <div ref={containerRef} className="dock-panel__cells">
        {occupied.map(({ cell, index }, position) => {
          const def = getDockPanelDefinition(cell.kind);
          const grow = !bothOccupied ? 1 : position === 0 ? dock.splitRatio : 1 - dock.splitRatio;
          return (
            <div
              key={`${index}-${cell.kind}-${cell.params.path ?? ''}`}
              className="dock-cell"
              data-testid={`dock-cell-${index}`}
              style={{ flexGrow: grow, flexBasis: 0 }}
            >
              {position === 1 && (
                <div
                  className="dock-cell__divider"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize dock cells"
                  onPointerDown={onDividerPointerDown}
                />
              )}
              <div className="dock-cell__header">
                <span className="dock-cell__icon" aria-hidden="true">{def?.icon()}</span>
                <span className="dock-cell__title" title={cell.params.path ?? def?.title}>
                  {dockCellTitle(cell)}
                </span>
                <span className="dock-cell__actions">
                  {bothOccupied && (
                    <button
                      type="button"
                      title="Swap cells"
                      aria-label="Swap dock cells"
                      onClick={() => dock.swapCells()}
                    >
                      <Icons.Refresh />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Collapse dock"
                    aria-label="Collapse dock"
                    onClick={() => dock.setCollapsed(true)}
                  >
                    <Icons.Chevron />
                  </button>
                  <button
                    type="button"
                    title="Close panel"
                    aria-label={`Close ${dockCellTitle(cell)}`}
                    onClick={() => dock.closeCell(index)}
                  >
                    <Icons.Close />
                  </button>
                </span>
              </div>
              <div className="dock-cell__body">
                {def
                  ? <def.Component params={cell.params} cell={index} />
                  : <div className="dock-panel__notice">Unknown panel: {cell.kind}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

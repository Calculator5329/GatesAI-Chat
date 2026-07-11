// One window-level attachment target. This deliberately owns all drag/drop
// listeners so a drop cannot bubble through a second composer-level handler.
import { useEffect, useRef, useState } from 'react';
import type { BridgeStore } from '../../../stores/BridgeStore';
import type { UiStore } from '../../../stores/UiStore';
import { handleFileDrop, isFileDrag } from './composerAttachments';

export function useWindowFileDrop(ui: UiStore, bridge: BridgeStore): boolean {
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const clearDragState = () => {
      dragDepthRef.current = 0;
      setDragActive(false);
    };
    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDrop = (event: DragEvent) => {
      const handled = handleFileDrop(event, files => { void ui.uploadFiles(files, bridge); });
      if (handled) clearDragState();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [bridge, ui]);

  return dragActive;
}

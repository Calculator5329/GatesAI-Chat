interface CopyClickGesture {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  hasSelection: boolean;
}

export function shouldCopyMessageFromClick(gesture: CopyClickGesture) {
  return gesture.button === 0 && (gesture.ctrlKey || gesture.metaKey) && !gesture.hasSelection;
}

export function hasActiveTextSelection() {
  return Boolean(window.getSelection()?.toString());
}

import { describe, expect, it } from 'vitest';
import { shouldCopyMessageFromClick } from '../../../src/components/editorial/messageCopy';

describe('message copy gesture', () => {
  it('copies on primary ctrl-click or meta-click when no text is selected', () => {
    expect(shouldCopyMessageFromClick({ button: 0, ctrlKey: true, metaKey: false, hasSelection: false })).toBe(true);
    expect(shouldCopyMessageFromClick({ button: 0, ctrlKey: false, metaKey: true, hasSelection: false })).toBe(true);
  });

  it('ignores ordinary clicks, secondary clicks, and text selection clicks', () => {
    expect(shouldCopyMessageFromClick({ button: 0, ctrlKey: false, metaKey: false, hasSelection: false })).toBe(false);
    expect(shouldCopyMessageFromClick({ button: 1, ctrlKey: true, metaKey: false, hasSelection: false })).toBe(false);
    expect(shouldCopyMessageFromClick({ button: 0, ctrlKey: true, metaKey: false, hasSelection: true })).toBe(false);
  });
});

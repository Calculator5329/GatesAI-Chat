import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChordRecorder } from '../../../src/components/menu/sections/ChordRecorder';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderRecorder(onChange = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onReset = vi.fn();
  act(() => {
    root!.render(createElement(ChordRecorder, {
      value: 'Ctrl+Shift+Space',
      onChange,
      onReset,
    }));
  });
  return { input: host.querySelector('input') as HTMLInputElement, onChange, onReset };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('ChordRecorder', () => {
  it('captures a modifier plus key chord', () => {
    const { input, onChange } = renderRecorder();

    act(() => input.dispatchEvent(new FocusEvent('focus', { bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    })));

    expect(onChange).toHaveBeenCalledWith('Ctrl+Shift+K');
  });

  it('rejects modifier-only input', () => {
    const { input, onChange } = renderRecorder();

    act(() => input.dispatchEvent(new FocusEvent('focus', { bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Shift',
      shiftKey: true,
      bubbles: true,
    })));

    expect(onChange).not.toHaveBeenCalled();
    expect(host?.textContent).toContain('Press at least one modifier and a key.');
  });
});

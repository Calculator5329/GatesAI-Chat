// The switch contract: an accessible name (its visible label lives in a
// sibling div that assistive tech never associates with it), correct
// aria-checked, and no inline styling — presentation belongs to
// .ui-toggle in editorial.css, because an inline transform on the thumb
// silently beat the :active press animation written for it.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toggle } from '../../../src/components/ui/Toggle';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderToggle(props: Parameters<typeof Toggle>[0]): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(Toggle, props)); });
  return host.querySelector('.ui-toggle') as HTMLButtonElement;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Toggle', () => {
  it('exposes its label as the switch name and reports checked state', () => {
    const control = renderToggle({ on: true, onChange: () => {}, label: 'Semantic recall' });

    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('aria-label')).toBe('Semantic recall');
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.getAttribute('data-on')).toBe('true');
  });

  it('marks the off state so the thumb can be positioned from CSS', () => {
    const control = renderToggle({ on: false, onChange: () => {}, label: 'Global summon' });

    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.hasAttribute('data-on')).toBe(false);
  });

  it('leaves the thumb free of inline styles so :active can compose a transform', () => {
    const control = renderToggle({ on: true, onChange: () => {}, label: 'Global summon' });
    const thumb = control.querySelector('.ui-toggle__thumb') as HTMLElement;

    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute('style')).toBeNull();
    expect(control.getAttribute('style')).toBeNull();
  });

  it('toggles to the opposite value, and does nothing while disabled', () => {
    const onChange = vi.fn();
    const control = renderToggle({ on: false, onChange, label: 'Automatic thread titles' });
    act(() => control.click());
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    act(() => root!.render(createElement(Toggle, {
      on: false, onChange, disabled: true, label: 'Automatic thread titles',
    })));
    act(() => (host!.querySelector('.ui-toggle') as HTMLButtonElement).click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

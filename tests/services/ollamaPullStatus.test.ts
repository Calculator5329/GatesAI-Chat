import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OllamaPullAction,
  OllamaPullStatus,
  type OllamaPullSnapshot,
} from '../../src/components/menu/OllamaPullStatus';

function renderState({
  installed = false,
  pulling = false,
  snapshot,
  online = true,
}: {
  installed?: boolean;
  pulling?: boolean;
  snapshot?: OllamaPullSnapshot;
  online?: boolean;
} = {}): HTMLElement {
  const markup = renderToStaticMarkup(
    createElement('div', null,
      createElement(OllamaPullStatus, {
        model: 'qwen2.5:7b',
        installed,
        pulling,
        snapshot,
      }),
      createElement(OllamaPullAction, {
        model: 'qwen2.5:7b',
        online,
        installed,
        pulling,
        snapshot,
        onPull: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('OllamaPullStatus', () => {
  it('renders the explicit idle state with a user-initiated pull action', () => {
    const rendered = renderState();

    expect(rendered.querySelector('[data-ollama-pull-state="idle"]')).not.toBeNull();
    expect(rendered.querySelector('[role="progressbar"]')).toBeNull();
    expect(rendered.querySelector('button')?.textContent).toBe('Pull');
  });

  it('renders pulling progress and a cancel action', () => {
    const rendered = renderState({
      pulling: true,
      snapshot: { percent: 42, phase: 'pulling layer' },
    });

    expect(rendered.querySelector('[data-ollama-pull-state="pulling"]')?.textContent).toContain('pulling layer · 42%');
    expect(rendered.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(rendered.querySelector('button')?.textContent).toBe('Cancel');
  });

  it('renders daemon failures with quiet recovery copy and retry', () => {
    const rendered = renderState({
      snapshot: { percent: 17, phase: 'Failed', error: 'TypeError: Failed to fetch' },
    });

    expect(rendered.querySelector('[data-ollama-pull-state="failed"] [role="alert"]')?.textContent)
      .toContain("Couldn't reach Ollama");
    expect(rendered.querySelector('button')?.textContent).toBe('Retry');
  });

  it('returns a cancelled pull to the non-alarming idle state', () => {
    const rendered = renderState({
      snapshot: { percent: 17, phase: 'Cancelled', error: 'Pull cancelled.' },
    });

    expect(rendered.querySelector('[data-ollama-pull-state="idle"]')).not.toBeNull();
    expect(rendered.querySelector('[role="alert"]')).toBeNull();
    expect(rendered.querySelector('button')?.textContent).toBe('Pull');
  });

  it('lets an installed catalog race win over stale failure state', () => {
    const rendered = renderState({
      installed: true,
      snapshot: { percent: 95, phase: 'Failed', error: 'connection closed' },
    });

    expect(rendered.querySelector('[data-ollama-pull-state="done"]')?.textContent).toContain('Installed');
    expect(rendered.querySelector('[role="alert"]')).toBeNull();
    expect(rendered.querySelector('button')).toBeNull();
  });
});

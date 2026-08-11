import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { PromptStore } from '../../../src/stores/PromptStore';
import { UiStore } from '../../../src/stores/UiStore';
import { PromptCards } from '../../../src/components/editorial/PromptCards';
import type { RootStore } from '../../../src/stores/RootStore';
import type { AssistantPromptRequest } from '../../../src/core/prompts';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST: AssistantPromptRequest = {
  kind: 'approval',
  question: 'Delete the stale build folder?',
  context: 'It has not been touched since March.',
  options: [
    { id: 'option-0', label: 'Delete it', detail: 'Frees 400MB' },
    { id: 'option-1', label: 'Leave it' },
  ],
  grounds: ['Last modified 8 months ago', 'Nothing imports from it'],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let prompts: PromptStore;
let store: RootStore;

function render(threadId: string | null): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, {
      store,
      children: createElement(PromptCards, { threadId }),
    }));
  });
  return host;
}

function click(element: Element | null): void {
  if (!element) throw new Error('missing element');
  act(() => {
    (element as HTMLButtonElement).click();
  });
}

beforeEach(() => {
  clearAppStorage();
  prompts = new PromptStore();
  store = { prompts, ui: new UiStore() } as RootStore;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('PromptCards', () => {
  it('renders nothing without a thread or a pending question', () => {
    expect(render(null).querySelector('.prompt-cards')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    expect(render('t1').querySelector('.prompt-cards')).toBeNull();
  });

  it('shows the question, its context, its grounds, and its options', () => {
    void prompts.ask(REQUEST, { threadId: 't1' });
    const rendered = render('t1');
    expect(rendered.querySelector('.prompt-card__question')?.textContent).toBe('Delete the stale build folder?');
    expect(rendered.querySelector('.prompt-card__context')?.textContent).toContain('since March');
    expect(Array.from(rendered.querySelectorAll('.prompt-card__grounds li')).map(li => li.textContent))
      .toEqual(['Last modified 8 months ago', 'Nothing imports from it']);
    const options = rendered.querySelectorAll('.prompt-card__option');
    expect(options).toHaveLength(2);
    // The model's preferred option comes first and is marked as such.
    expect(options[0].getAttribute('data-primary')).toBe('true');
  });

  it('resolves the waiting tool call when an option is picked', async () => {
    const pending = prompts.ask(REQUEST, { threadId: 't1' });
    const rendered = render('t1');
    click(rendered.querySelector('.prompt-card__option'));
    await expect(pending).resolves.toMatchObject({ text: 'Delete it', declined: false });
    expect(rendered.querySelector('.prompt-card')).toBeNull();
  });

  it('always offers a way out, so a blocked turn can never wedge', async () => {
    const pending = prompts.ask(REQUEST, { threadId: 't1' });
    const rendered = render('t1');
    click(rendered.querySelector('.prompt-card__decline'));
    await expect(pending).resolves.toMatchObject({ declined: true });
  });

  it('hides the free-text field unless the model allowed it', () => {
    void prompts.ask(REQUEST, { threadId: 't1' });
    expect(render('t1').querySelector('.prompt-card__free')).toBeNull();
    act(() => root?.unmount());
    host?.remove();

    prompts.decline(prompts.pending[0].id);
    void prompts.ask({ ...REQUEST, allowFreeText: true }, { threadId: 't1' });
    expect(render('t1').querySelector('.prompt-card__free')).not.toBeNull();
  });

  it('ignores questions belonging to another thread', () => {
    void prompts.ask(REQUEST, { threadId: 'other' });
    expect(render('t1').querySelector('.prompt-card')).toBeNull();
  });

  it('renders in both packs, tagged so each can style it', () => {
    void prompts.ask(REQUEST, { threadId: 't1' });
    expect(render('t1').querySelector('.prompt-cards')?.getAttribute('data-pack')).toBe('classic');
    act(() => root?.unmount());
    host?.remove();

    act(() => store.ui.setUiPack('aurora'));
    expect(render('t1').querySelector('.prompt-cards')?.getAttribute('data-pack')).toBe('aurora');
  });
});

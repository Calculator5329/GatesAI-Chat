import { autorun, observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiStore } from '../../src/stores/UiStore';

describe('UiStore', () => {
  const stores: UiStore[] = [];
  const buildUi = (): UiStore => {
    const ui = new UiStore();
    stores.push(ui);
    return ui;
  };

  afterEach(() => {
    while (stores.length > 0) stores.pop()?.dispose();
    vi.restoreAllMocks();
  });

  it('bindDraftThread isolates composer drafts per thread', () => {
    const ui = buildUi();

    ui.bindDraftThread('thread-a');
    ui.setDraft('draft for A');

    ui.bindDraftThread('thread-b');
    expect(ui.draft).toBe('');
    ui.setDraft('draft for B');

    ui.bindDraftThread('thread-a');
    expect(ui.draft).toBe('draft for A');

    ui.bindDraftThread('thread-b');
    expect(ui.draft).toBe('draft for B');
  });

  it('bindDraftThread persists attachments per thread', () => {
    const ui = buildUi();
    const attA = { id: 'a1', path: '/a.png', filename: 'a.png', mime: 'image/png', size: 1 };
    const attB = { id: 'b1', path: '/b.png', filename: 'b.png', mime: 'image/png', size: 2 };

    ui.bindDraftThread('thread-a');
    ui.addAttachment(attA);

    ui.bindDraftThread('thread-b');
    expect(ui.attachments).toEqual([]);
    ui.addAttachment(attB);

    ui.bindDraftThread('thread-a');
    expect(ui.attachments).toEqual([attA]);
  });

  it('binds drafts from reactions without MobX strict-mode mutation warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ui = buildUi();
    const activeThreadId = observable.box<string | null>('thread-a');
    const dispose = autorun(() => {
      ui.bindDraftThread(activeThreadId.get());
    });

    ui.setDraft('draft for A');
    runInAction(() => activeThreadId.set('thread-b'));
    ui.setDraft('draft for B');
    runInAction(() => activeThreadId.set('thread-a'));

    dispose();

    const mobxMutationWarnings = warn.mock.calls
      .flat()
      .filter(value => String(value).includes('changing (observed) observable values'));
    expect(mobxMutationWarnings).toEqual([]);
    expect(ui.draft).toBe('draft for A');
  });
});

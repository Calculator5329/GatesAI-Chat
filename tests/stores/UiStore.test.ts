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

  // Settings hands these straight to a child's onChange, so they are invoked as
  // bare functions with no receiver. setTheme was missing from the action.bound
  // list, so clicking Dark/Light/System threw "Cannot set properties of
  // undefined" and the theme switcher did nothing at all. This asserts the
  // whole set rather than just the one that broke.
  it('setters passed to child components as bare props keep their receiver', () => {
    const ui = buildUi();
    const detached = {
      setTheme: ui.setTheme,
      setAutoNamingEnabled: ui.setAutoNamingEnabled,
      setCloseButtonHidesToTray: ui.setCloseButtonHidesToTray,
      setGlobalSummonEnabled: ui.setGlobalSummonEnabled,
      setGlobalSummonChord: ui.setGlobalSummonChord,
      setCodeLineNumbers: ui.setCodeLineNumbers,
    };

    expect(() => detached.setTheme('light')).not.toThrow();
    expect(ui.theme).toBe('light');

    detached.setAutoNamingEnabled(false);
    expect(ui.autoNamingEnabled).toBe(false);
    detached.setCloseButtonHidesToTray(true);
    expect(ui.closeButtonHidesToTray).toBe(true);
    detached.setGlobalSummonEnabled(false);
    expect(ui.globalSummonEnabled).toBe(false);
    detached.setGlobalSummonChord('Ctrl+Alt+G');
    expect(ui.globalSummonChord).toBe('Ctrl+Alt+G');
    detached.setCodeLineNumbers(true);
    expect(ui.codeLineNumbers).toBe(true);
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

  it('keeps tool-output disclosure choices isolated per message in ephemeral UI state', () => {
    const ui = buildUi();

    expect(ui.toolOutputOpenState('message-a', 'activity-1')).toBeUndefined();
    ui.setToolOutputOpen('message-a', 'activity-1', true);
    ui.setToolOutputOpen('message-b', 'activity-1', false);

    expect(ui.toolOutputOpenState('message-a', 'activity-1')).toBe(true);
    expect(ui.toolOutputOpenState('message-b', 'activity-1')).toBe(false);
    expect(ui.prefsSnapshot).not.toHaveProperty('toolOutputOpenByKey');
  });

  it('switches the UI pack and carries it in the persisted prefs snapshot', () => {
    const ui = buildUi();

    expect(ui.uiPack).toBe('classic');
    ui.setUiPack('aurora');
    expect(ui.uiPack).toBe('aurora');
    expect(ui.prefsSnapshot.uiPack).toBe('aurora');
  });

  it('falls back to Classic for a pack this build no longer ships', () => {
    const ui = buildUi();

    ui.setUiPack('elements' as never);
    expect(ui.uiPack).toBe('classic');
  });
});

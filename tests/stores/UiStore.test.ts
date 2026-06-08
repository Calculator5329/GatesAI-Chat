import { describe, expect, it } from 'vitest';
import { UiStore } from '../../src/stores/UiStore';

describe('UiStore', () => {
  it('bindDraftThread isolates composer drafts per thread', () => {
    const ui = new UiStore();

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
    const ui = new UiStore();
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
});

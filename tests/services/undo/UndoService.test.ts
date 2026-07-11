import { describe, expect, it, vi } from 'vitest';
import { UndoService } from '../../../src/services/undo/UndoService';

describe('UndoService', () => {
  it('undoes registered commands in last-in-first-out order', () => {
    const undo = new UndoService();
    const calls: string[] = [];

    undo.register({ label: 'Delete first', undo: () => calls.push('first') });
    undo.register({ label: 'Delete second', undo: () => calls.push('second') });

    expect(undo.getSnapshot()).toMatchObject({ canUndo: true, nextLabel: 'Delete second' });
    expect(undo.undo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(undo.undo()).toBe(false);
    expect(calls).toEqual(['second', 'first']);
    expect(undo.getSnapshot()).toMatchObject({ canUndo: false, event: 'undone' });
  });

  it('caps history and notifies subscribers when state changes', () => {
    const undo = new UndoService(2);
    const listener = vi.fn();
    const unsubscribe = undo.subscribe(listener);
    const calls: string[] = [];

    undo.register({ label: 'One', undo: () => calls.push('one') });
    undo.register({ label: 'Two', undo: () => calls.push('two') });
    undo.register({ label: 'Three', undo: () => calls.push('three') });
    undo.undo();
    undo.undo();
    unsubscribe();

    expect(calls).toEqual(['three', 'two']);
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it('keeps a command available when its inverse throws', () => {
    const undo = new UndoService();
    undo.register({ label: 'Fragile action', undo: () => { throw new Error('failed'); } });

    expect(() => undo.undo()).toThrow('failed');
    expect(undo.getSnapshot()).toMatchObject({ canUndo: true, nextLabel: 'Fragile action' });
  });
});

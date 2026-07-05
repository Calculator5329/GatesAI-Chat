import { describe, expect, it } from 'vitest';
import { diffLines } from '../../../src/services/diff/lineDiff';

describe('diffLines', () => {
  it('returns context rows for identical text', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'context', text: 'b', oldLine: 2, newLine: 2 },
    ]);
  });

  it('shows added lines', () => {
    expect(diffLines('a', 'a\nb')).toEqual([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'added', text: 'b', newLine: 2 },
    ]);
  });

  it('shows removed lines', () => {
    expect(diffLines('a\nb', 'a')).toEqual([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'removed', text: 'b', oldLine: 2 },
    ]);
  });

  it('shows replacements as remove and add rows', () => {
    expect(diffLines('a\nold\nc', 'a\nnew\nc')).toEqual([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'added', text: 'new', newLine: 2 },
      { type: 'removed', text: 'old', oldLine: 2 },
      { type: 'context', text: 'c', oldLine: 3, newLine: 3 },
    ]);
  });

  it('handles empty inputs', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'a')).toEqual([{ type: 'added', text: 'a', newLine: 1 }]);
    expect(diffLines('a', '')).toEqual([{ type: 'removed', text: 'a', oldLine: 1 }]);
  });

  it('normalizes trailing newlines', () => {
    expect(diffLines('a\n', 'a')).toEqual([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
    ]);
  });
});

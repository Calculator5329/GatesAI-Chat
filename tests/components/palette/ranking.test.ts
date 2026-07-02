import { describe, expect, it } from 'vitest';
import { rankPaletteItems } from '../../../src/components/palette/ranking';

describe('command palette ranking', () => {
  it('prefers direct title matches and filters non-matches', () => {
    const ranked = rankPaletteItems([
      { label: 'Open workspace', keywords: ['files'] },
      { label: 'Invoice follow-up', subtitle: 'Workspace billing notes' },
      { label: 'New conversation' },
    ], 'invoice');

    expect(ranked.map(entry => entry.item.label)).toEqual(['Invoice follow-up']);
  });

  it('supports case-insensitive subsequence matches without a fuzzy dependency', () => {
    const ranked = rankPaletteItems([
      { label: 'Open gallery' },
      { label: 'New conversation' },
      { label: 'Open models' },
    ], 'nwc');

    expect(ranked[0]?.item.label).toBe('New conversation');
  });
});

// "Open the report at `/workspace/x.html`." renders the path as a block-level
// artifact card, which splits the paragraph and strands the sentence's full
// stop on its own line underneath. This covers the rule that drops it.
import { describe, expect, it } from 'vitest';
import { isOrphanPunctuation } from '../../../src/components/editorial/MarkdownChunk';

describe('isOrphanPunctuation', () => {
  it('accepts punctuation and whitespace', () => {
    for (const value of ['.', ' .', '.\n', ');', '?!', '  ', '']) {
      expect(isOrphanPunctuation(value)).toBe(true);
    }
  });

  it('rejects anything carrying a word', () => {
    for (const value of ['. Open it', 'and more.', 'x', '. 2 files']) {
      expect(isOrphanPunctuation(value)).toBe(false);
    }
  });

  it('rejects non-strings, so elements are never dropped', () => {
    expect(isOrphanPunctuation({})).toBe(false);
    expect(isOrphanPunctuation(null)).toBe(false);
    expect(isOrphanPunctuation(undefined)).toBe(false);
  });
});

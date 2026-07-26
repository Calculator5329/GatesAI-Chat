import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCodeToClipboard, languageLabelFromClassName } from '../../../src/components/editorial/MarkdownChunk';
import { htmlDocumentTitle, isCompleteHtmlDocument } from '../../../src/components/editorial/HtmlArtifactPreview';

describe('rendered code block helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses the language emitted from a fence info string', () => {
    expect(languageLabelFromClassName('hljs language-typescript extra')).toBe('typescript');
    expect(languageLabelFromClassName('language-c++')).toBe('c++');
    expect(languageLabelFromClassName()).toBeNull();
  });

  it('offers preview only for complete HTML documents', () => {
    expect(isCompleteHtmlDocument('<!doctype html><html><body>Ready</body></html>')).toBe(true);
    expect(isCompleteHtmlDocument('<html><body>Still streaming')).toBe(false);
    expect(isCompleteHtmlDocument('<section>HTML fragment</section>')).toBe(false);
  });

  it('names a fenced HTML document from its title, or not at all', () => {
    expect(htmlDocumentTitle('<html><title>Quarterly report</title></html>')).toBe('Quarterly report');
    expect(htmlDocumentTitle('<title lang="en">\n  Spread   out\n</title>')).toBe('Spread out');
    expect(htmlDocumentTitle('<html><title>   </title></html>')).toBeNull();
    expect(htmlDocumentTitle('<html><body>No title here</body></html>')).toBeNull();
  });

  it('copies the exact code text to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await expect(copyCodeToClipboard('const answer = 42;\n')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('const answer = 42;\n');
  });

  it('reports clipboard failures without throwing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    await expect(copyCodeToClipboard('secret')).resolves.toBe(false);
  });
});

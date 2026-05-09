import { describe, expect, it } from 'vitest';
import { splitMarkdownChunks } from '../../../src/components/editorial/markdownChunks';

describe('splitMarkdownChunks', () => {
  it('returns empty array for empty input', () => {
    expect(splitMarkdownChunks('')).toEqual([]);
  });

  it('returns single chunk when no paragraph break', () => {
    expect(splitMarkdownChunks('hello world')).toEqual(['hello world']);
  });

  it('splits on a blank line', () => {
    const input = 'first paragraph\n\nsecond paragraph';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual(['first paragraph\n\n', 'second paragraph']);
    expect(chunks.join('')).toBe(input);
  });

  it('splits on multiple paragraphs', () => {
    const input = 'a\n\nb\n\nc';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual(['a\n\n', 'b\n\n', 'c']);
    expect(chunks.join('')).toBe(input);
  });

  it('does not split inside a fenced code block', () => {
    const input = 'intro\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\nouter';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual([
      'intro\n\n',
      '```js\nconst x = 1;\n\nconst y = 2;\n```\n\n',
      'outer',
    ]);
    expect(chunks.join('')).toBe(input);
  });

  it('keeps an unclosed fence as one trailing chunk (mid-stream)', () => {
    const input = 'intro\n\n```js\nconst x = 1;\n\nconst y = 2;';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual([
      'intro\n\n',
      '```js\nconst x = 1;\n\nconst y = 2;',
    ]);
    expect(chunks.join('')).toBe(input);
  });

  it('handles tilde fences', () => {
    const input = 'a\n\n~~~\nx\n\ny\n~~~\n\nb';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual(['a\n\n', '~~~\nx\n\ny\n~~~\n\n', 'b']);
    expect(chunks.join('')).toBe(input);
  });

  it('collapses multiple blank lines into one boundary', () => {
    const input = 'a\n\n\n\nb';
    const chunks = splitMarkdownChunks(input);
    expect(chunks).toEqual(['a\n\n\n\n', 'b']);
    expect(chunks.join('')).toBe(input);
  });

  it('preserves trailing newline-only content', () => {
    const input = 'a\n';
    const chunks = splitMarkdownChunks(input);
    expect(chunks.join('')).toBe(input);
  });

  it('handles indented fence (still toggles)', () => {
    const input = 'a\n\n  ```\nfoo\n\nbar\n  ```\n\nb';
    const chunks = splitMarkdownChunks(input);
    expect(chunks.join('')).toBe(input);
    // The fenced block stays as a single chunk
    expect(chunks).toEqual(['a\n\n', '  ```\nfoo\n\nbar\n  ```\n\n', 'b']);
  });

  it('splits CRLF input on a blank line', () => {
    const input = 'a\r\n\r\nb';
    const chunks = splitMarkdownChunks(input);
    expect(chunks.length).toBe(2);
    expect(chunks.join('')).toBe(input);
  });

  it('does not split inside a CRLF fenced block', () => {
    const input = 'intro\r\n\r\n```js\r\nconst x = 1;\r\n\r\nconst y = 2;\r\n```\r\n\r\nouter';
    const chunks = splitMarkdownChunks(input);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(input);
  });

  it('does NOT treat a 4-space-indented ``` as a fence (CommonMark indented code)', () => {
    // The ``` is part of an indented code block, not a fence; the blank lines
    // around it should still split normally.
    const input = 'a\n\n    ```\n\nb';
    const chunks = splitMarkdownChunks(input);
    expect(chunks.join('')).toBe(input);
    // Three chunks because each blank line is a real boundary (no open fence).
    expect(chunks).toEqual(['a\n\n', '    ```\n\n', 'b']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  splitMarkdownChunks,
  splitMarkdownChunksIncremental,
  type MarkdownChunkSnapshot,
  type MarkdownTextChunk,
} from '../../../src/components/editorial/markdownChunks';

function chunkText(chunks: MarkdownTextChunk[]): string[] {
  return chunks.map(chunk => chunk.content);
}

function expectChunkOffsets(chunks: MarkdownTextChunk[], content: string) {
  let offset = 0;
  for (const chunk of chunks) {
    expect(chunk.start).toBe(offset);
    offset += chunk.content.length;
    expect(chunk.end).toBe(offset);
    expect(chunk.key).toBe(`md-${chunk.start}`);
  }
  expect(offset).toBe(content.length);
}

function randomCutPoints(length: number, seed: number): number[] {
  const cuts = [0, length];
  let state = seed >>> 0;
  for (let index = 0; index < 200; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    cuts.push(Math.floor((state / 0x100000000) * (length + 1)));
  }
  return cuts.sort((a, b) => a - b);
}

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

describe('splitMarkdownChunksIncremental', () => {
  const fixtures = [
    {
      name: 'nested-looking fences',
      content: [
        'Intro paragraph before code.',
        '',
        '```ts',
        'const fence = "```";',
        '',
        'function demo() {',
        '  return fence;',
        '}',
        '```',
        '',
        'After the code block.',
        '',
        '~~~',
        'tilde body',
        '',
        'with a blank line',
        '~~~',
        '',
        'Done.',
      ].join('\n'),
    },
    {
      name: 'fence-marker lines inside fences',
      content: [
        'Outer intro.',
        '',
        '```md',
        'A nested marker follows on its own line.',
        '```',
        'This line is parsed according to the existing toggle rules.',
        '```',
        '',
        'Back outside.',
        '',
        '```',
        'final block',
        '```',
      ].join('\n'),
    },
    {
      name: 'unterminated fence',
      content: [
        'Before.',
        '',
        '```python',
        'def example():',
        '    return 1',
        '',
        'Still inside the fence.',
        '',
        'No closer yet.',
      ].join('\n'),
    },
    {
      name: 'mermaid and math',
      content: [
        'Diagram:',
        '',
        '```mermaid',
        'graph TD',
        '  A[Start] --> B{Choice}',
        '  B --> C[End]',
        '```',
        '',
        'Inline math \\(x + y\\) and block math:',
        '',
        '$$',
        'a^2 + b^2 = c^2',
        '$$',
      ].join('\n'),
    },
    {
      name: 'tables and long prose',
      content: [
        'This paragraph is intentionally long so the seeded stream has many useful cut points. '.repeat(12),
        '',
        '| Name | Value |',
        '| --- | ---: |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        '',
        'Final prose '.repeat(40),
      ].join('\n'),
    },
    {
      name: 'crlf fences',
      content: [
        'intro',
        '',
        '  ```js',
        'const x = 1;',
        '',
        'const y = 2;',
        '  ```',
        '',
        'outer',
      ].join('\r\n'),
    },
    {
      name: 'commonmark indented fence text',
      content: [
        'a',
        '',
        '    ```',
        '',
        'b',
        '',
        '```',
        'real fence',
        '```',
      ].join('\n'),
    },
  ];

  it('matches full parsing at every streamed cut point', () => {
    fixtures.forEach((fixture, fixtureIndex) => {
      let snapshot: MarkdownChunkSnapshot | undefined;
      for (const cut of randomCutPoints(fixture.content.length, 0x51eed + fixtureIndex)) {
        const content = fixture.content.slice(0, cut);
        const chunks = splitMarkdownChunksIncremental(content, snapshot);

        expect(chunkText(chunks), fixture.name).toEqual(splitMarkdownChunks(content));
        expect(chunks.map(chunk => chunk.content).join(''), fixture.name).toBe(content);
        expectChunkOffsets(chunks, content);

        snapshot = { content, chunks };
      }
    });
  });

  it('keeps earlier closed-fence chunks referentially stable while appending prose', () => {
    const base = [
      'Intro',
      '',
      '```js',
      'const value = 1;',
      '```',
      '',
      'Tail',
    ].join('\n');
    let chunks = splitMarkdownChunksIncremental(base);
    let snapshot: MarkdownChunkSnapshot = { content: base, chunks };
    const introChunk = chunks[0];
    const codeChunk = chunks[1];

    for (const suffix of [' grows', ' with more words', '\nand another line']) {
      const content = snapshot.content + suffix;
      chunks = splitMarkdownChunksIncremental(content, snapshot);

      expect(chunks[0]).toBe(introChunk);
      expect(chunks[1]).toBe(codeChunk);
      expect(chunkText(chunks)).toEqual(splitMarkdownChunks(content));

      snapshot = { content, chunks };
    }
  });

  it('falls back to a full parse for non-append edits', () => {
    const original = 'alpha\n\n```ts\nconst x = 1;\n```\n\nomega';
    const originalChunks = splitMarkdownChunksIncremental(original);
    const edited = 'ALPHA\n\n```ts\nconst x = 2;\n```\n\nomega';
    const editedChunks = splitMarkdownChunksIncremental(edited, {
      content: original,
      chunks: originalChunks,
    });

    expect(chunkText(editedChunks)).toEqual(splitMarkdownChunks(edited));
    expect(editedChunks[0]).not.toBe(originalChunks[0]);
  });
});

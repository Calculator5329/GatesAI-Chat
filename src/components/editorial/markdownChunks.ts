/**
 * Split a markdown string at paragraph boundaries (`\n\n`) while respecting
 * fenced code blocks. A fence is a line whose trimmed start is ``` (three or
 * more backticks). Splits inside an open fence are suppressed so a code block
 * stays in one chunk.
 *
 * Each returned chunk preserves a trailing `\n\n` (except possibly the last)
 * so concatenating the chunks reconstructs the original string exactly.
 *
 * Used to chunk streaming markdown so closed (non-trailing) chunks can be
 * memoized and skipped on every token flush — only the trailing chunk
 * re-parses while the model streams.
 */
export interface MarkdownTextChunk {
  content: string;
  start: number;
  end: number;
  key: string;
}

export interface MarkdownChunkSnapshot {
  content: string;
  chunks: MarkdownTextChunk[];
}

export function splitMarkdownChunks(content: string): string[] {
  return splitMarkdownChunkRecords(content).map(chunk => chunk.content);
}

export function splitMarkdownChunksIncremental(
  content: string,
  prev?: MarkdownChunkSnapshot,
): MarkdownTextChunk[] {
  if (!prev || !content.startsWith(prev.content)) {
    return splitMarkdownChunkRecords(content);
  }
  if (content === prev.content) {
    return prev.chunks;
  }
  if (prev.chunks.length === 0) {
    return splitMarkdownChunkRecords(content);
  }

  const lastChunk = prev.chunks[prev.chunks.length - 1];
  const stableChunks = prev.chunks.slice(0, -1);
  const reparsedChunks = splitMarkdownChunkRecords(content.slice(lastChunk.start), lastChunk.start);
  return stableChunks.concat(reparsedChunks);
}

function splitMarkdownChunkRecords(content: string, offset = 0): MarkdownTextChunk[] {
  if (!content) return [];
  const chunks: MarkdownTextChunk[] = [];
  let start = 0;
  let inFence = false;
  let i = 0;
  // Walk line by line, tracking fence toggles. Split on a blank line (\n\n)
  // only when not inside a fenced block.
  while (i < content.length) {
    // Find end of current line
    const nl = content.indexOf('\n', i);
    const lineEnd = nl === -1 ? content.length : nl;
    // Strip a trailing \r so CRLF inputs don't break fence detection.
    const rawLine = content.slice(i, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // CommonMark: a line indented 4+ spaces is an indented code block, not
    // a fence. Only toggle when indent < 4.
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();
    if (indent < 4 && (trimmed.startsWith('```') || trimmed.startsWith('~~~'))) {
      inFence = !inFence;
    }
    // After processing this line, check for blank-line boundary. The next
    // line is "blank" if the next char is '\n' (LF) or '\r\n' (CRLF).
    const nextIsBlank =
      nl !== -1 &&
      lineEnd + 1 < content.length &&
      (content[lineEnd + 1] === '\n' ||
        content.startsWith('\r\n', lineEnd + 1));
    if (!inFence && nextIsBlank) {
      // Consume all consecutive newlines (LF or CRLF) as part of the
      // boundary so the next chunk starts at real content.
      let boundaryEnd = lineEnd + 1; // past the current line's '\n'
      while (boundaryEnd < content.length) {
        if (content[boundaryEnd] === '\n') {
          boundaryEnd++;
        } else if (content.startsWith('\r\n', boundaryEnd)) {
          boundaryEnd += 2;
        } else {
          break;
        }
      }
      chunks.push(createChunk(content, start, boundaryEnd, offset));
      start = boundaryEnd;
      i = boundaryEnd;
      continue;
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  if (start < content.length) {
    chunks.push(createChunk(content, start, content.length, offset));
  }
  return chunks;
}

function createChunk(source: string, start: number, end: number, offset: number): MarkdownTextChunk {
  const absoluteStart = offset + start;
  const absoluteEnd = offset + end;
  return {
    content: source.slice(start, end),
    start: absoluteStart,
    end: absoluteEnd,
    key: `md-${absoluteStart}`,
  };
}

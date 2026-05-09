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
export function splitMarkdownChunks(content: string): string[] {
  if (!content) return [];
  const chunks: string[] = [];
  let start = 0;
  let inFence = false;
  let i = 0;
  // Walk line by line, tracking fence toggles. Split on a blank line (\n\n)
  // only when not inside a fenced block.
  while (i < content.length) {
    // Find end of current line
    const nl = content.indexOf('\n', i);
    const lineEnd = nl === -1 ? content.length : nl;
    const line = content.slice(i, lineEnd);
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
    }
    // After processing this line, check for blank-line boundary:
    // pattern is content[lineEnd] === '\n' && content[lineEnd+1] === '\n'
    if (
      !inFence &&
      nl !== -1 &&
      lineEnd + 1 < content.length &&
      content[lineEnd + 1] === '\n'
    ) {
      // Consume all consecutive newlines as part of the boundary so the
      // next chunk starts at real content.
      let boundaryEnd = lineEnd + 2;
      while (boundaryEnd < content.length && content[boundaryEnd] === '\n') {
        boundaryEnd++;
      }
      chunks.push(content.slice(start, boundaryEnd));
      start = boundaryEnd;
      i = boundaryEnd;
      continue;
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  if (start < content.length) {
    chunks.push(content.slice(start));
  }
  return chunks;
}

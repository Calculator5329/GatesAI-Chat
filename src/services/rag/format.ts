import type { Note } from '../../core/notes';
import type { Thread } from '../../core/types';
import type { RagSearchResult } from './vectorStore';
import type { RagRetrievalResult } from './retrieval';

export interface RagFormatSources {
  threads: Thread[];
  notes: Note[];
}

export function formatRecallResults(results: RagSearchResult[], sources: RagFormatSources): string {
  if (results.length === 0) return 'No semantic memory matches.';
  return results.map(result => {
    const label = sourceLabel(result, sources);
    const date = new Date(result.chunk.updatedAt).toISOString();
    return [
      `${label} (${date}, score ${result.score.toFixed(2)})`,
      `> ${snippet(result.chunk.text)}`,
    ].join('\n');
  }).join('\n\n');
}

export function formatStructuredRecallResults(results: RagRetrievalResult[]): string {
  if (results.length === 0) return 'No semantic memory matches.';
  return results.map(result => {
    const role = result.role ? `, ${result.role}` : '';
    const title = result.sourceTitle?.trim() || result.threadId || result.sourceId;
    return [
      `${result.sourceType}: ${title}${role} (${new Date(result.updatedAt).toISOString()}) [${result.reference}]`,
      `> ${snippet(result.text)}`,
    ].join('\n');
  }).join('\n\n');
}

export function formatSemanticContextBlock(
  results: RagSearchResult[],
  sources: RagFormatSources,
  maxChars = 2_000,
): string {
  if (results.length === 0) return '';
  const lines = ['--- Possibly relevant past context ---'];
  for (const result of results) {
    const label = sourceLabel(result, sources);
    const date = new Date(result.chunk.updatedAt).toISOString();
    lines.push(`- ${label} (${date}, score ${result.score.toFixed(2)}): "${oneLine(result.chunk.text)}"`);
    if (lines.join('\n').length >= maxChars) break;
  }
  lines.push('--- End past context ---');
  const block = lines.join('\n');
  return block.length > maxChars ? `${block.slice(0, maxChars - 15).trimEnd()}\n[truncated]` : block;
}

function sourceLabel(result: RagSearchResult, sources: RagFormatSources): string {
  const chunk = result.chunk;
  if (chunk.sourceType === 'message') {
    const thread = sources.threads.find(item => item.id === chunk.threadId);
    return `thread: ${thread?.title?.trim() || chunk.threadId || 'unknown'}`;
  }
  if (chunk.sourceType === 'note') {
    const note = sources.notes.find(item => item.id === chunk.sourceId);
    return note?.title?.trim() ? `note: ${note.title.trim()}` : 'note';
  }
  return 'memory';
}

function snippet(text: string): string {
  const line = oneLine(text);
  return line.length > 600 ? `${line.slice(0, 597)}...` : line;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

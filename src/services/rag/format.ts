import type { RagRetrievalResult } from './retrieval';

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

function snippet(text: string): string {
  const line = oneLine(text);
  return line.length > 600 ? `${line.slice(0, 597)}...` : line;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

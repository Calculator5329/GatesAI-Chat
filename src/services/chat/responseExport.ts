import type { Message } from '../../core/types';
import { messageText } from '../../core/messageParts';

export interface ResponseOrigin {
  threadId: string;
}

export function createResponseExport(message: Message, origin: ResponseOrigin, streaming: boolean, modelName?: string, exportedAt = new Date()) {
  const text = messageText(message);
  if (message.role !== 'assistant' || streaming || !text.trim() || !origin.threadId) {
    throw new Error('Only a completed, nonempty assistant response can be downloaded.');
  }
  const metadata = JSON.stringify({
    threadId: origin.threadId,
    messageId: message.id,
    messageCreatedAt: message.createdAt,
    exportedAt: exportedAt.toISOString(),
    modelLabel: modelName ?? null,
  }, null, 2).replace(/`/g, '\\u0060').replace(/</g, '\\u003c');
  const id = message.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'response';
  return {
    filename: `gatesai-response-${id}-${exportedAt.toISOString().slice(0, 10)}.md`,
    content: `${text}\n\n---\n\n## GatesAI export provenance\n\n\`\`\`json\n${metadata}\n\`\`\`\n`,
  };
}

export function downloadResponse(message: Message, origin: ResponseOrigin, streaming: boolean, modelName?: string): void {
  const { content, filename } = createResponseExport(message, origin, streaming, modelName);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

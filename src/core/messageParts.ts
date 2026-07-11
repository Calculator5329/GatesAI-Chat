// Canonical message content-part constructors, selectors, and mutation helpers.
// The legacy fallbacks are intentionally centralized here so callers never
// need to understand parallel content/tool/attachment fields.
import type {
  AssistantMessage,
  Message,
  MessageAttachmentRef,
  MessageContentPart,
  ToolContentPart,
  ToolResult,
  UserMessage,
} from './types';
import type { ToolCall } from './llm';

export function userMessageParts(text: string, attachments: MessageAttachmentRef[] = []): MessageContentPart[] {
  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...attachments.map(attachment => attachmentPart(attachment)),
  ];
}

export function assistantMessageParts(args: {
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}): MessageContentPart[] {
  const parts = pairToolParts(args.toolCalls ?? [], args.toolResults ?? []);
  if (args.text) parts.push({ type: 'text', text: args.text });
  return parts;
}

export function contentPartsForMessage(message: Message): MessageContentPart[] {
  if (message.parts) return message.parts;
  if (message.role === 'user') {
    return userMessageParts(message.content ?? '', message.attachments ?? []);
  }
  return assistantMessageParts({
    text: message.content,
    toolCalls: message.toolCalls,
    toolResults: message.toolResults,
  });
}

export function messageText(message: Message): string {
  return contentPartsForMessage(message)
    .filter((part): part is Extract<MessageContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('');
}

export function messageAttachments(message: UserMessage): MessageAttachmentRef[] {
  return contentPartsForMessage(message)
    .filter((part): part is Extract<MessageContentPart, { type: 'image' | 'artifact' } > =>
      part.type === 'image' || part.type === 'artifact')
    .map(part => part.attachment);
}

export function messageToolParts(message: AssistantMessage): ToolContentPart[] {
  return contentPartsForMessage(message)
    .filter((part): part is ToolContentPart => part.type === 'tool');
}

export function messageToolCalls(message: AssistantMessage): ToolCall[] {
  return messageToolParts(message).flatMap(part => part.call ? [part.call] : []);
}

export function messageToolResults(message: AssistantMessage): ToolResult[] {
  return messageToolParts(message).flatMap(part => part.result ? [part.result] : []);
}

/** Convert an accepted legacy-shaped message into the canonical persisted form. */
export function canonicalizeMessage<T extends Message>(message: T): T {
  const canonical = { ...message, parts: contentPartsForMessage(message).map(clonePart) } as T;
  delete (canonical as Message & { content?: string }).content;
  if (canonical.role === 'user') {
    delete canonical.attachments;
  } else {
    delete canonical.toolCalls;
    delete canonical.toolResults;
  }
  return canonical;
}

export function setMessageText(message: Message, text: string): void {
  ensureCanonicalParts(message);
  const indexes = message.parts
    ?.map((part, index) => part.type === 'text' ? index : -1)
    .filter(index => index >= 0) ?? [];
  for (let i = indexes.length - 1; i >= 0; i -= 1) message.parts?.splice(indexes[i], 1);
  if (text) message.parts?.push({ type: 'text', text });
}

export function appendMessageText(message: Message, delta: string): void {
  if (!delta) return;
  ensureCanonicalParts(message);
  const last = message.parts?.[message.parts.length - 1];
  if (last?.type === 'text') last.text += delta;
  else message.parts?.push({ type: 'text', text: delta });
}

export function appendToolCalls(message: AssistantMessage, calls: ToolCall[]): void {
  if (!calls.length) return;
  ensureCanonicalParts(message);
  message.parts?.push(...calls.map(call => ({ type: 'tool' as const, call })));
}

export function appendToolResults(message: AssistantMessage, results: ToolResult[]): void {
  if (!results.length) return;
  ensureCanonicalParts(message);
  for (const result of results) {
    const target = message.parts?.find(part =>
      part.type === 'tool' && part.call?.id === result.toolCallId && !part.result,
    );
    if (target?.type === 'tool') target.result = result;
    else message.parts?.push({ type: 'tool', result });
  }
}

function ensureCanonicalParts(message: Message): void {
  if (message.parts) return;
  const canonical = canonicalizeMessage(message);
  message.parts = canonical.parts;
  delete message.content;
  if (message.role === 'user') delete message.attachments;
  else {
    delete message.toolCalls;
    delete message.toolResults;
  }
}

function attachmentPart(attachment: MessageAttachmentRef): MessageContentPart {
  return /^image\//i.test(attachment.mime)
    ? { type: 'image', attachment }
    : { type: 'artifact', attachment };
}

function pairToolParts(calls: ToolCall[], results: ToolResult[]): MessageContentPart[] {
  const used = new Set<number>();
  const parts: MessageContentPart[] = calls.map(call => {
    const resultIndex = results.findIndex((result, index) => !used.has(index) && result.toolCallId === call.id);
    if (resultIndex < 0) return { type: 'tool', call };
    used.add(resultIndex);
    return { type: 'tool', call, result: results[resultIndex] };
  });
  results.forEach((result, index) => {
    if (!used.has(index)) parts.push({ type: 'tool', result });
  });
  return parts;
}

function clonePart(part: MessageContentPart): MessageContentPart {
  return JSON.parse(JSON.stringify(part)) as MessageContentPart;
}

import type { ToolCall } from '../../core/llm';

export function isToolFailureContent(toolName: string, content: string): boolean {
  const trimmed = content.trim();
  if (/^status:\s*error/im.test(trimmed)) return true;
  if (/^Error(?: executing [\w-]+)?:/i.test(trimmed)) return true;
  if ((toolName === 'terminal' || toolName === 'git') && /^\$ .+\n\[exit [1-9]\d*/m.test(trimmed)) return true;
  return false;
}

export function failureReason(content: string): string {
  const lines = content.trim().split('\n');
  const summaryLine = lines.find(line => /^summary:\s*/i.test(line));
  if (summaryLine) return summaryLine.replace(/^summary:\s*/i, '').slice(0, 500);
  const exitLine = lines.find(line => /^\[exit [1-9]\d*/.test(line));
  return (exitLine ?? lines[0])?.slice(0, 500) || 'Tool returned an empty error.';
}

export function safeJsonPreview(value: unknown, maxChars = 1200): string {
  const sensitiveKeys = new Set(['content', 'stdin', 'fact', 'next', 'body', 'message', 'apiKey', 'token', 'password', 'secret']);
  const json = JSON.stringify(value, (key, child) => {
    if (sensitiveKeys.has(key)) {
      if (typeof child === 'string') return `[redacted ${child.length} chars]`;
      return '[redacted]';
    }
    if (typeof child === 'string' && child.length > 240) return `${child.slice(0, 240)}...[truncated ${child.length - 240} chars]`;
    return child;
  });
  if (!json) return '';
  return json.length > maxChars ? `${json.slice(0, maxChars)}...[truncated ${json.length - maxChars} chars]` : json;
}

export function logToolCallFailure(opts: {
  call: ToolCall;
  threadId: string;
  content: string;
  startedAt: number;
  bridgeOnline: boolean | undefined;
  readOnly: boolean;
}): void {
  console.warn('[tool-call-failed]', {
    toolName: opts.call.name,
    toolCallId: opts.call.id,
    threadId: opts.threadId,
    reason: failureReason(opts.content),
    resultPreview: opts.content.slice(0, 1200),
    argumentsPreview: safeJsonPreview(opts.call.arguments),
    bridgeOnline: opts.bridgeOnline ?? false,
    readOnly: opts.readOnly,
    durationMs: Date.now() - opts.startedAt,
    ranAt: new Date().toISOString(),
  });
}

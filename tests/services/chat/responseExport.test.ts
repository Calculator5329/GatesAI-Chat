import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/core/types';
import { createResponseExport } from '../../../src/services/chat/responseExport';

const message: Message = { id: 'm1', role: 'assistant', createdAt: 123, parts: [{ type: 'text', text: '  # Exact\r\n\n**body**\n' }] };
describe('response Markdown download', () => {
  it('keeps the exact text snapshot and separately encoded source identity', () => {
    const exported = createResponseExport(message, { threadId: 'source```<thread' }, false, 'Model', new Date('2026-09-05T12:00:00Z'));
    expect(exported.content.startsWith('  # Exact\r\n\n**body**\n\n\n---')).toBe(true);
    const metadata = JSON.parse(exported.content.split('```json\n')[1].split('\n```')[0]);
    expect(metadata).toEqual({ threadId: 'source```<thread', messageId: 'm1', messageCreatedAt: 123, exportedAt: '2026-09-05T12:00:00.000Z', modelLabel: 'Model' });
    expect(exported.filename).toBe('gatesai-response-m1-2026-09-05.md');
  });
  it('refuses streaming, empty, nonassistant, and missing-origin inputs', () => {
    expect(() => createResponseExport(message, { threadId: 't1' }, true)).toThrow();
    expect(() => createResponseExport({ ...message, parts: [] }, { threadId: 't1' }, false)).toThrow();
    expect(() => createResponseExport({ ...message, role: 'user' }, { threadId: 't1' }, false)).toThrow();
    expect(() => createResponseExport(message, { threadId: '' }, false)).toThrow();
  });
});

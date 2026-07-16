import { describe, expect, it } from 'vitest';
import type { AssistantMessage, ChatSnapshot } from '../../src/core/types';
import {
  appendMessageText,
  appendToolCalls,
  appendToolResults,
  assistantMessageParts,
  contentPartsForMessage,
  messageAttachments,
  messageText,
  messageToolCalls,
  messageToolResults,
  setMessageText,
  userMessageParts,
} from '../../src/core/messageParts';
import { parseChatSnapshotValue, prepareChatSnapshotForSave } from '../../src/services/persistence';
import { CURRENT_CHAT_SCHEMA_VERSION } from '../../src/services/persistence/migrations';

describe('content-parts message model', () => {
  it('keeps user text, images, and file artifacts in send order', () => {
    const parts = userMessageParts('Review both.', [
      { id: 'image', path: '/workspace/attachments/shot.png', name: 'shot.png', mime: 'image/png', size: 10 },
      { id: 'file', path: '/workspace/attachments/data.csv', name: 'data.csv', mime: 'text/csv', size: 20 },
    ]);

    expect(parts.map(part => part.type)).toEqual(['text', 'image', 'artifact']);
    const message = { id: 'u', role: 'user' as const, parts, createdAt: 1 };
    expect(messageText(message)).toBe('Review both.');
    expect(messageAttachments(message).map(attachment => attachment.id)).toEqual(['image', 'file']);
  });

  it('pairs duplicate-id tool calls/results by occurrence and leaves final prose last', () => {
    const parts = assistantMessageParts({
      text: 'Finished.',
      toolCalls: [
        { id: 'dup', name: 'fs', arguments: { path: 'one' } },
        { id: 'dup', name: 'fs', arguments: { path: 'two' } },
      ],
      toolResults: [
        { toolCallId: 'dup', toolName: 'fs', content: 'one', ranAt: 2 },
        { toolCallId: 'dup', toolName: 'fs', content: 'two', ranAt: 3 },
      ],
    });

    expect(parts.map(part => part.type)).toEqual(['tool', 'tool', 'text']);
    expect(parts.filter(part => part.type === 'tool').map(part => part.result?.content)).toEqual(['one', 'two']);
  });

  it('appends streaming rounds incrementally without losing part order', () => {
    const message: AssistantMessage = { id: 'a', role: 'assistant', parts: [], createdAt: 1 };
    appendMessageText(message, 'working');
    setMessageText(message, '');
    appendToolCalls(message, [{ id: 'c1', name: 'memory', arguments: {} }]);
    appendToolResults(message, [{ toolCallId: 'c1', toolName: 'memory', content: 'saved', ranAt: 2 }]);
    appendMessageText(message, 'Done.');

    expect(contentPartsForMessage(message).map(part => part.type)).toEqual(['tool', 'text']);
    expect(messageToolResults(message)[0].content).toBe('saved');
    expect(messageText(message)).toBe('Done.');
  });

  it('migrates every legacy payload used by ordinary and tour threads on read', () => {
    const loaded = parseChatSnapshotValue({
      schemaVersion: 2,
      activeThreadId: 'tour',
      threads: [{
        id: 'tour', title: 'Tour', subtitle: '', pinned: true, readOnly: true,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          {
            id: 'u', role: 'user', content: 'Look.', createdAt: 1,
            attachments: [
              { id: 'i', path: '/workspace/attachments/tour.png', name: 'tour.png', mime: 'image/png', size: 0 },
              { id: 'f', path: '/workspace/attachments/tour.pdf', name: 'tour.pdf', mime: 'application/pdf', size: 4 },
            ],
          },
          {
            id: 'a1', role: 'assistant', content: '', createdAt: 2,
            toolCalls: [{ id: 'c1', name: 'artifact', arguments: { action: 'create_html_artifact' } }],
          },
          { id: 'legacy-tool', role: 'tool', content: 'created', createdAt: 3, toolCallId: 'c1', toolName: 'artifact' },
          { id: 'a2', role: 'assistant', content: 'Ready.', createdAt: 4 },
        ],
      }],
    });

    expect(loaded?.schemaVersion).toBe(CURRENT_CHAT_SCHEMA_VERSION);
    const user = loaded!.threads[0].messages[0];
    expect(contentPartsForMessage(user).map(part => part.type)).toEqual(['text', 'image', 'artifact']);
    const assistant = loaded!.threads[0].messages[1];
    expect(assistant.role).toBe('assistant');
    if (assistant.role !== 'assistant') return;
    expect(messageToolCalls(assistant)[0].name).toBe('artifact');
    expect(messageToolResults(assistant)[0].content).toBe('created');
    expect(messageText(assistant)).toBe('Ready.');
    expect(assistant).not.toHaveProperty('content');
    expect(assistant).not.toHaveProperty('toolCalls');
    expect(assistant).not.toHaveProperty('toolResults');
  });

  it('preserves existing structured image and image-job tool artifacts', () => {
    const loaded = parseChatSnapshotValue({
      schemaVersion: 2,
      activeThreadId: 't',
      threads: [{
        id: 't', title: 'Artifacts', subtitle: '', pinned: false, modelId: 'or-gpt-5.4-mini',
        createdAt: 1, updatedAt: 2,
        messages: [{
          id: 'a', role: 'assistant', content: 'Queued.', createdAt: 2,
          toolResults: [{
            toolCallId: 'c', toolName: 'image_generate', content: 'queued', ranAt: 3,
            artifacts: [
              { kind: 'image', path: '/workspace/artifacts/image.png', mime: 'image/png' },
              { kind: 'image-job', jobId: 'job-1', count: 2 },
            ],
          }],
        }],
      }],
    });
    const assistant = loaded!.threads[0].messages[0];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');
    expect(messageToolResults(assistant)[0].artifacts).toEqual([
      { kind: 'image', path: '/workspace/artifacts/image.png', mime: 'image/png' },
      { kind: 'image-job', jobId: 'job-1', count: 2 },
    ]);
  });

  it('round-trips the versioned canonical persistence shape', () => {
    const snapshot: ChatSnapshot = {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
      activeThreadId: 't',
      threads: [{
        id: 't', title: 'Parts', subtitle: '', pinned: false, modelId: 'or-gpt-5.4-mini',
        createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user', parts: userMessageParts('Hi'), createdAt: 1 },
          { id: 'a', role: 'assistant', parts: assistantMessageParts({ text: 'Hello' }), createdAt: 2 },
        ],
      }],
    };

    const persisted = prepareChatSnapshotForSave(snapshot);
    const roundTripped = parseChatSnapshotValue(JSON.parse(JSON.stringify(persisted)));
    expect(roundTripped).toMatchObject(snapshot);
    expect(roundTripped?.threads[0].messages.every(message => Array.isArray(message.parts))).toBe(true);
  });
});

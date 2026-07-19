// Coordinates one user turn's streaming lifecycle outside ChatStore.
// ChatStore remains the MobX state owner; this engine owns abort controllers,
// the text buffer, and the send/start/interrupt control flow that used to live
// inlined on the store. MobX stays out of services — the host supplies
// runInAction for async mutation boundaries.
import type { Message, StreamActivity, Thread } from '../../core/types';
import { formatAttachmentFooter, toMessageAttachmentRef } from '../../core/attachments';
import { messageText, setMessageText, userMessageParts } from '../../core/messageParts';
import { StreamingTextBuffer } from '../streaming/StreamingTextBuffer';
import { logEvent } from '../diagnostics/chatLog';
import { logger } from '../diagnostics/logger';
import type { StreamingRoundActivityUpdate } from './streamingRoundExecutor';
import type { TurnRunner } from './turnRunner';

export interface ChatTurnAttachment {
  id?: string;
  filename: string;
  path: string;
  size: number;
  mime: string;
}

export interface ChatTurnEngineHost {
  runInAction(fn: () => void): void;
  newMessageId(): string;
  ensureThreadModel(threadId: string | null): Thread | null;
  findMessage(threadId: string, messageId: string): Message | undefined;
  appendMessage(threadId: string, message: Message): void;
  setActiveThreadId(threadId: string): void;
  setThreadLastError(threadId: string, message: string | null): void;
  getStreamingMessageId(threadId: string): string | undefined;
  setStreamingMessageId(threadId: string, messageId: string | undefined): void;
  getStreamActivity(threadId: string): StreamActivity | undefined;
  setStreamActivity(threadId: string, activity: StreamActivity | undefined): void;
  appendChunk(threadId: string, messageId: string, chunk: string): void;
}

export interface ChatTurnEngineDeps {
  host: ChatTurnEngineHost;
  turnRunner: TurnRunner;
}

/**
 * Owns turn-start / interrupt / streaming bookkeeping for ChatStore.
 * Observable fields stay on the store; controllers and the text buffer live here.
 */
export class ChatTurnEngine {
  private readonly host: ChatTurnEngineHost;
  private readonly turnRunner: TurnRunner;
  private readonly controllersByThread = new Map<string, AbortController>();
  private readonly textBuffer = new StreamingTextBuffer();

  constructor(deps: ChatTurnEngineDeps) {
    this.host = deps.host;
    this.turnRunner = deps.turnRunner;
  }

  isThreadStreaming(threadId: string): boolean {
    return Boolean(this.host.getStreamingMessageId(threadId));
  }

  getController(threadId: string): AbortController | undefined {
    return this.controllersByThread.get(threadId);
  }

  setController(threadId: string, controller: AbortController): void {
    this.controllersByThread.set(threadId, controller);
  }

  ownsStreamingTurn(threadId: string, messageId: string): boolean {
    return this.host.getStreamingMessageId(threadId) === messageId;
  }

  flushText(messageId: string): void {
    this.textBuffer.flush(messageId);
  }

  cancelText(messageId: string): void {
    this.textBuffer.cancel(messageId);
  }

  sendMessageToHydratedThread(
    threadId: string,
    text: string,
    attachments: ChatTurnAttachment[] = [],
  ): void {
    const thread = this.host.ensureThreadModel(threadId);
    const trimmed = text.trim();
    if (!thread || thread.readOnly || thread.archived || (!trimmed && attachments.length === 0)) return;
    const isReplacingInterruptedReply = this.isThreadStreaming(thread.id);
    if (this.isThreadStreaming(thread.id)) {
      this.interruptThread(thread.id);
    }

    this.host.setThreadLastError(thread.id, null);

    const attachmentFooter = formatAttachmentFooter(attachments);
    const refs = attachments.map(toMessageAttachmentRef);

    const userMessage: Message = {
      id: this.host.newMessageId(),
      role: 'user',
      parts: userMessageParts((trimmed + attachmentFooter).trim() || '(see attachments)', refs),
      createdAt: Date.now(),
    };
    this.host.appendMessage(thread.id, userMessage);

    const targetThreadId = thread.id;
    const controller = new AbortController();
    this.controllersByThread.set(targetThreadId, controller);

    this.runTurn(targetThreadId, controller.signal, isReplacingInterruptedReply)
      .catch(err => this.host.runInAction(() => {
        logger.error('chat', 'runTurn failed', { threadId: targetThreadId, err });
        this.host.setThreadLastError(targetThreadId, (err as Error).message);
        if (this.controllersByThread.get(targetThreadId) === controller) {
          this.clearStreamingState(targetThreadId);
        }
      }));
  }

  startTurn(threadId: string, isReplacingInterruptedReply = false): void {
    const thread = this.host.ensureThreadModel(threadId);
    if (!thread || thread.messages.length === 0) return;
    if (this.isThreadStreaming(thread.id)) this.interruptThread(thread.id);
    this.host.setActiveThreadId(thread.id);
    this.host.setThreadLastError(thread.id, null);
    const controller = new AbortController();
    this.controllersByThread.set(thread.id, controller);
    this.runTurn(thread.id, controller.signal, isReplacingInterruptedReply)
      .catch(err => this.host.runInAction(() => {
        logger.error('chat', 'runTurn failed', { threadId: thread.id, err });
        this.host.setThreadLastError(thread.id, (err as Error).message);
        if (this.controllersByThread.get(thread.id) === controller) {
          this.clearStreamingState(thread.id);
        }
      }));
  }

  stopStreaming(activeThreadId: string | null): void {
    if (!activeThreadId) return;
    if (!this.isThreadStreaming(activeThreadId)) return;
    this.interruptThread(activeThreadId);
  }

  interruptThread(threadId: string): void {
    const messageId = this.host.getStreamingMessageId(threadId);
    const controller = this.controllersByThread.get(threadId);
    if (controller) controller.abort();

    if (messageId) {
      this.textBuffer.flush(messageId);
      const message = this.host.findMessage(threadId, messageId);
      if (message && message.role === 'assistant') {
        const partial = messageText(message).trim();
        setMessageText(message, partial ? `${messageText(message)}\n\n*[interrupted]*` : '*[no response]*');
      }
    }
    this.clearStreamingState(threadId);
  }

  clearStreamingState(threadId: string, expectedMessageId?: string): void {
    if (expectedMessageId && this.host.getStreamingMessageId(threadId) !== expectedMessageId) return;
    this.host.setStreamingMessageId(threadId, undefined);
    this.host.setStreamActivity(threadId, undefined);
    this.controllersByThread.delete(threadId);
  }

  abortAllStreams(): void {
    for (const controller of this.controllersByThread.values()) controller.abort();
    this.controllersByThread.clear();
    this.textBuffer.cancelAll();
  }

  applyRoundActivityUpdate(threadId: string, messageId: string, update: StreamingRoundActivityUpdate): void {
    if (!this.ownsStreamingTurn(threadId, messageId)) return;
    if (update.phase === 'stalled') {
      logEvent(threadId, 'round.streamStalled', {
        messageId,
        idleSeconds: update.idleSeconds,
        providerId: update.providerId,
        providerModelId: update.providerModelId,
        round: update.round,
      });
    }
    this.host.runInAction(() => {
      const existing = this.host.getStreamActivity(threadId);
      if (update.phase === 'connecting') {
        this.host.setStreamActivity(threadId, {
          messageId,
          phase: 'connecting',
          startedAt: existing?.startedAt ?? update.at,
          lastProviderAt: update.at,
          round: update.round,
          providerId: update.providerId,
          providerModelId: update.providerModelId,
        });
        return;
      }
      if (!existing || existing.messageId !== messageId || existing.phase === 'stalled') return;
      this.host.setStreamActivity(threadId, {
        ...existing,
        phase: update.phase,
        lastProviderAt: update.phase === 'stalled' ? existing.lastProviderAt : update.at,
        stallReason: update.phase === 'stalled' ? update.stallReason : undefined,
      });
    });
  }

  markStreamActivityPhase(threadId: string, messageId: string, phase: StreamActivity['phase']): void {
    if (!this.ownsStreamingTurn(threadId, messageId)) return;
    this.host.runInAction(() => {
      const existing = this.host.getStreamActivity(threadId);
      if (!existing || existing.messageId !== messageId || existing.phase === 'stalled') return;
      this.host.setStreamActivity(threadId, {
        ...existing,
        phase,
        lastProviderAt: Date.now(),
        stallReason: undefined,
      });
    });
  }

  queueTextChunk(threadId: string, messageId: string, chunk: string): void {
    this.textBuffer.enqueue(messageId, chunk, text => {
      if (!this.ownsStreamingTurn(threadId, messageId)) return;
      this.host.runInAction(() => this.host.appendChunk(threadId, messageId, text));
    });
  }

  async runTurn(
    threadId: string,
    signal: AbortSignal,
    isReplacingInterruptedReply = false,
    options: { maxToolRounds?: number } = {},
  ): Promise<void> {
    await this.turnRunner.run(threadId, signal, {
      isReplacingInterruptedReply,
      maxToolRounds: options.maxToolRounds,
    });
  }
}

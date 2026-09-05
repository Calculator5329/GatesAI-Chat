// Everything an observer can learn about a turn, as one closed union.
//
// v4 spreads this across `StreamActivity` phases, `queueTextChunk`,
// `applyRoundActivityUpdate`, `markStreamActivityPhase`,
// `updateAssistantMessage`, `setThreadLastError` and `clearStreamingState`
// — seven host callbacks that together describe one lifecycle. Here it is
// one type, so a new observer is a switch statement rather than seven
// methods that a host must implement correctly.

import type { ConversationId, MessageId, StopReason, TokenUsage } from './model';

interface TurnEventBase {
  readonly conversationId: ConversationId;
  readonly at: number;
}

export type TurnEvent =
  | (TurnEventBase & { readonly type: 'turn.started'; readonly userMessageId: MessageId })
  | (TurnEventBase & { readonly type: 'assistant.started'; readonly messageId: MessageId; readonly modelId: string })
  | (TurnEventBase & { readonly type: 'assistant.delta'; readonly messageId: MessageId; readonly delta: string })
  | (TurnEventBase & {
      readonly type: 'assistant.stopped';
      readonly messageId: MessageId;
      readonly reason: StopReason;
      readonly text: string;
      readonly error?: string;
      readonly usage?: TokenUsage;
    })
  | (TurnEventBase & { readonly type: 'conversation.saved'; readonly revision: number });

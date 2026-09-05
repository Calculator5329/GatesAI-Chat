// Public seam of the headless core.
//
// Everything an application or an extension is allowed to depend on is
// exported here. Anything not exported here is free to change, which is the
// only way an extension API can be a promise rather than a hope.

export {
  appendAssistantText,
  appendUserMessage,
  beginAssistantMessage,
  conversationId,
  createConversation,
  DomainError,
  isStreaming,
  messageId,
  promptMessages,
  stopAssistantMessage,
} from './domain/model';
export type {
  AssistantMessage,
  Conversation,
  ConversationId,
  Message,
  MessageId,
  Role,
  StopReason,
  TokenUsage,
  UserMessage,
} from './domain/model';

export type { TurnEvent } from './domain/events';
export type {
  ChatTransport,
  Clock,
  CompletionChunk,
  CompletionRequest,
  ConversationRepository,
  IdSource,
  TurnListener,
  TurnPlugin,
} from './domain/ports';

export { runChatTurn } from './domain/runTurn';
export type { TurnDependencies, TurnInput, TurnResult } from './domain/runTurn';

export { ChatRuntime, createChatRuntime } from './runtime/createChatRuntime';
export type { ChatRuntimeOptions, SendOptions } from './runtime/createChatRuntime';

export { OpenAiCompatTransport } from './transport/openAiCompatTransport';
export type { FetchLike, OpenAiCompatTransportOptions } from './transport/openAiCompatTransport';

export {
  CURRENT_SCHEMA_VERSION,
  InMemoryConversationRepository,
  KeyValueConversationRepository,
  MapKeyValueStore,
} from './persistence/keyValueRepository';
export type { KeyValueRepositoryOptions, KeyValueStore } from './persistence/keyValueRepository';

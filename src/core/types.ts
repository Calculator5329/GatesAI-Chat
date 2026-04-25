import type { ToolCall } from './llm';

export type Role = 'user' | 'assistant';

/**
 * A single message in a thread. Discriminated by `role`:
 *
 * - `user`:      text from the human.
 * - `assistant`: a single round of model output. May carry text content,
 *                a list of tool calls the model made during the round, and
 *                a parallel list of tool results we collected before the next
 *                round. One message per round trip — see {@link AssistantMessage}.
 *
 * Tool results are NOT separate messages. They're metadata on the assistant
 * message that triggered them. This matches the mental model (a tool result
 * isn't something anyone "said") and keeps the renderer trivial — no
 * pairing or look-ahead needed. The wire-level provider format still uses
 * separate `tool` messages; that translation lives in
 * `services/llm/wireFormat.ts`.
 *
 * Legacy snapshots stored tool results as their own `role: 'tool'` messages.
 * `loadSnapshot()` migrates those forward by folding each tool message into
 * the preceding assistant's `toolResults`.
 */
export type Message = UserMessage | AssistantMessage;

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: number;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  createdAt: number;
  model?: string;
  /** Label for the empty pre-token streaming state. Omitted means "thinking". */
  preTokenLabel?: 'thinking' | 'responding' | 'compacting';
  /** Tool calls the model made during this round. Empty / omitted when none. */
  toolCalls?: ToolCall[];
  /** Results from executing those tool calls. Length matches toolCalls; pair by id. */
  toolResults?: ToolResult[];
}

/**
 * Output of one tool execution, attached to the assistant message that
 * called it. Lives on the message rather than as its own row because nobody
 * "said" the result — it's the function's return value the model reads on
 * its next round.
 */
export interface ToolResult {
  /** Matches the corresponding {@link ToolCall.id} on the same assistant message. */
  toolCallId: string;
  /** Tool name, denormalized so we can render without joining back to the call. */
  toolName: string;
  /** Result string the tool returned (and the model sees on its next round). */
  content: string;
  /** When the tool finished. */
  ranAt: number;
}

export interface Thread {
  id: string;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  modelId: string;
  messages: Message[];
  /**
   * Optional per-thread context appended to the system prompt under
   * "About this conversation: …". Persists with the snapshot. No UI to edit
   * it yet — written by the model via tools and (eventually) by a thread
   * settings panel.
   */
  threadContext?: string;
  /**
   * One- to two-sentence digest of this conversation, regenerated lazily
   * by `SummaryStore` when the thread goes idle or accumulates enough new
   * messages. Surfaces in *other* threads' system prompts under
   * "Recent conversations:" so the model has cross-chat awareness without
   * the cost of full retrieval.
   */
  summary?: string;
  /** When `summary` was last written; drives the staleness check. */
  summaryUpdatedAt?: number;
  /**
   * `messages.length` at the moment `summary` was last written. The summary
   * scheduler only re-runs when there are ≥ N new messages on top of this.
   */
  summaryMessageCount?: number;
  /**
   * True once the auto-namer has set this thread's title. Prevents the
   * namer from re-running on subsequent turns and lets the user rename
   * freely without us clobbering their choice.
   */
  autoNamed?: boolean;
  /**
   * Transient flag set while the auto-namer is in flight. Drives the
   * sidebar typewriter animation. Not persisted (we strip it on save) —
   * if a thread is mid-name when the tab closes, we just retry on next
   * load.
   */
  naming?: boolean;
}

import type { ProviderId } from './llm';

export interface Model {
  /** Stable user-facing id used in threads + UI. */
  id: string;
  name: string;
  vendor: string;
  /** Which provider implementation handles this model. */
  providerId: ProviderId;
  /** The actual model identifier the provider's API expects. */
  providerModelId: string;
  /** Hand-written one-liner. Optional for hydrated entries. */
  description?: string;
  /** Max input tokens, when known. */
  contextLength?: number;
  /** USD per 1M tokens. */
  pricing?: { prompt?: number; completion?: number };
  /** True for entries fetched at runtime (e.g. from OpenRouter). */
  dynamic?: boolean;
}

export interface ChatSnapshot {
  threads: Thread[];
  activeThreadId: string | null;
}

export type AccentKey = 'blue' | 'emerald' | 'violet' | 'amber' | 'rose' | 'cyan' | 'ivory';
export type BgKey = 'graphite' | 'charcoal' | 'slate' | 'espresso' | 'pure';
export type HeaderKey = 'reading' | 'wordmark' | 'monogram' | 'rule';
export type SendKey = 'arrow' | 'ghost' | 'circle' | 'enter' | 'quill';
export type ThreadHeaderKey = 'none' | 'topLeft' | 'topRight' | 'spine' | 'chip' | 'both';
export type MenuSectionKey = 'profile' | 'agent' | 'workspace' | 'settings' | 'usage' | 'api' | 'appearance';

/**
 * How the assistant's tool invocations and their results are rendered in
 * the chat. Choice is persisted via UiStore. All five variants prioritize
 * "stay out of the way" — the conversation is the content, the tool is
 * machinery. From most-visible to invisible:
 *
 *   - `whisper`: single dim mono line, "tool · action · result". One breath.
 *   - `dot`:     a single accent dot with the tool name. Just `● memory`.
 *   - `aside`:   italic serif aside, "saved a memory". Reads as muttering.
 *   - `mark`:    a thin accent rule in the left margin. No text at all.
 *   - `hidden`:  not rendered. Model sees it; you don't.
 */
export type ToolCallStyleKey = 'whisper' | 'dot' | 'aside' | 'mark' | 'hidden';
export type MarkdownStyleKey = 'editorial' | 'technical' | 'compact';
export type CodeStyleKey = 'obsidian' | 'terminal' | 'paper';
export type MarkdownDensityKey = 'compact' | 'comfortable' | 'spacious';
export type CodeSizeKey = 'small' | 'medium' | 'large';

export interface ThemeConfig {
  accent: string;
  accent2: string;
  accentGlow: string;
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  font: string;
  fontUi: string;
  fontMono: string;
}

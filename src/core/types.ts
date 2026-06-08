// Defines shared types domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
import type { LlmUsage, ToolCall } from './llm';

export type AssistantFinishReason = 'stop' | 'length' | 'tool_use' | 'cancelled' | 'content_filter' | 'error';

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
  /**
   * Files the user attached when sending this message. References workspace
   * paths only — bytes are resolved on-demand by provider adapters at send
   * time. Kept in parallel with the legacy attachment footer embedded in
   * {@link content}; newer messages are authoritative from this field,
   * older persisted messages fall back to {@link splitAttachmentFooter}.
   */
  attachments?: MessageAttachmentRef[];
}

/**
 * Structured reference to a file the user attached to a message. Holds a
 * workspace path and lightweight metadata; no base64 bytes live here.
 */
export interface MessageAttachmentRef {
  /** Workspace path, e.g. `/workspace/attachments/plan.csv`. */
  path: string;
  /** Short display name split from the path. */
  name: string;
  /** MIME type reported by the bridge at upload time. */
  mime: string;
  /** Bytes, as reported by the bridge. */
  size: number;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  createdAt: number;
  model?: string;
  /** Label for the empty pre-token streaming state. Omitted means "thinking". */
  preTokenLabel?: 'thinking' | 'responding' | 'compacting' | 'generating';
  /**
   * Non-final prose streamed before the model decided to call tools. Kept so
   * users do not see useful in-flight context vanish when a tool round begins.
   */
  workNotes?: string[];
  /** Tool calls the model made during this round. Empty / omitted when none. */
  toolCalls?: ToolCall[];
  /** Results from executing those tool calls. Length matches toolCalls; pair by id. */
  toolResults?: ToolResult[];
  /** Provider-reported usage/cost for the LLM request(s) that produced this message. */
  usage?: LlmUsage[];
  /** Why the provider stopped the final streamed round, when reported. */
  finishReason?: AssistantFinishReason;
  /**
   * UI-only ambient activity events that are not tool calls, such as bridge
   * connectivity transitions observed while this assistant turn was active.
   */
  activityEvents?: ActivityItem[];
}

/**
 * Structured artifact produced by a tool run, surfaced to the UI for
 * rich rendering (thumbnails, file links, …) without parsing the
 * model-facing `content` string. The `content` remains the
 * authoritative payload for the model; `artifacts` is for the UI.
 */
export type ToolResultArtifact =
  | {
      kind: 'image';
      /** Workspace path, e.g. `/workspace/artifacts/foo.png`. */
      path: string;
      mime: string;
    }
  | {
      kind: 'image-job';
      /** Reference into ImageJobStore. */
      jobId: string;
      /** Number of images this job is expected to produce. */
      count: number;
    };

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
  /** Concise UI-facing summary. Never parsed back out of {@link content}. */
  summary?: string;
  /** Whether the tool execution produced a successful outcome. */
  ok?: boolean;
  /** Low-cardinality error code for invalid/failed tool calls. */
  errorCode?: string;
  /** Whether retrying with corrected inputs or later environment state may work. */
  retryable?: boolean;
  /** Execution duration for diagnostics and UI. */
  durationMs?: number;
  /** Size of the model-visible result payload. */
  outputChars?: number;
  /** When the tool finished. */
  ranAt: number;
  /**
   * Optional structured outputs the UI can render directly (e.g. an image
   * thumbnail for `image_generate`). Empty / omitted for text-only tools.
   * The renderer should NOT regex the content string for these — read this
   * field instead.
   */
  artifacts?: ToolResultArtifact[];
}

export type ActivityKind = 'thinking' | 'tool' | 'image-job' | 'exec-tail' | 'bridge';
export type ActivityState = 'running' | 'done' | 'failed' | 'cancelled';

export interface ActivityDetail {
  type: 'markdown' | 'terminal';
  content?: string;
  lines?: Array<{ stream: 'stdout' | 'stderr'; text: string }>;
  placeholder?: string;
}

export interface ActivityStats {
  added?: number;
  removed?: number;
  /** Free-form label when added/removed don't apply (e.g. "3 files", "1.2 KB"). */
  label?: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  state: ActivityState;
  verb: string;
  target?: string;
  summary?: string;
  detail?: ActivityDetail;
  artifacts?: ToolResultArtifact[];
  startedAt: number;
  finishedAt?: number;
  toolCallId?: string;
  /** Inline diff/count chips rendered between target and elapsed. */
  stats?: ActivityStats;
  /** Stable grouping key. Consecutive rows with the same key collapse into one parent. */
  groupKey?: string;
}

/**
 * One file the user has staged for the next send. Once uploaded to the bridge
 * it carries its workspace path; the composer turns the chip set into an
 * attachment footer on the user message so the model can reference the path.
 */
export interface DraftAttachment {
  id: string;
  filename: string;
  /** Workspace path, e.g. `/workspace/attachments/foo.csv`. */
  path: string;
  size: number;
  mime: string;
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
   * Controls how much chat history is sent on the next model request.
   * Useful for small local Ollama models that cannot fit long threads.
   */
  contextMode?: 'full' | 'system-tools' | 'bare' | 'micro';
  /** Reasoning depth for providers that expose controllable thinking. */
  thinkingEffort?: ThinkingEffort;
  /**
   * Set when the user dismisses the thread from the sidebar. Soft-deleted
   * threads stay in storage (so an Undo can restore them) but are filtered
   * out of every list. There's no hard-purge yet — graveyard cleanup is a
   * future task.
   */
  deletedAt?: number;
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

import type { ProviderId, ThinkingEffort } from './llm';

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
  /** Legacy alias used by a few cached Ollama catalog entries. */
  contextWindow?: number;
  /** USD per 1M tokens. */
  pricing?: { prompt?: number; completion?: number };
  /** True for entries fetched at runtime (e.g. from OpenRouter). */
  dynamic?: boolean;
  /**
   * Whether this model can accept image inputs. When unset, callers fall
   * back to {@link modelSupportsVision} which pattern-matches known vision
   * families. Explicit values override the heuristic.
   */
  supportsVision?: boolean;
  /**
   * Whether this model is known to handle tool calls reliably. When unset,
   * callers should default to "yes" — false means the catalog flagged it as
   * known-bad. Used today for Ollama models where tool support varies wildly
   * between families.
   */
  supportsTools?: boolean;
}

export interface ChatSnapshot {
  threads: Thread[];
  activeThreadId: string | null;
}

export type MenuSectionKey = 'agent' | 'models' | 'local' | 'workspace' | 'gallery' | 'settings';

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

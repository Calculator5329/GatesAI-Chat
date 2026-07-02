// Owns observable ChatStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
//
// Decomposition map (formerly all inline here):
//   - persistence policy            → services/chat/chatPersistenceCoordinator
//   - tool batch execution          → services/chat/toolBatchExecutor
//   - context-mode request wiring   → services/chat/contextModes
//   - activity timeline projection  → services/chat/activityProjection
//   - turn failure/recovery copy    → services/chat/turnFormatting
//   - image-turn copy               → services/chat/imageTurnFormatting
//   - Ollama pseudo-tool rescue     → services/chat/pseudoToolRescue
//   - provider round streaming      → services/chat/streamingRoundExecutor
//   - pure thread selectors         → core/threadSelectors
import { makeAutoObservable, runInAction } from 'mobx';
import type { ActivityItem, AssistantFinishReason, AssistantMessage, ChatSnapshot, Message, StreamActivity, Thread, ToolResult } from '../core/types';
import type { LlmProvider, LlmRequest, ThinkingEffort, ToolCall } from '../core/llm';
import { DEFAULT_MODEL_ID } from '../core/models';
import { formatAttachmentFooter, isImageMime, splitAttachmentFooter, toMessageAttachmentRef } from '../core/attachments';
import {
  CHAT_SNAPSHOT_STORAGE_KEY,
  cancelPendingDeferredSnapshot,
  consumeSnapshotLoadError,
  loadSnapshot,
  saveSnapshot,
  setCompactionNoticeHandler,
} from '../services/persistence';
import { setMultiTabWriteHandler } from '../services/storage/persistenceProvider';
import { computeUsage, contextWindowFor, estimateLlmPayloadTokens, estimateTokens, type TokenUsage } from '../core/tokens';
import { resolveWireImages } from '../services/llm/resolveImages';
import { modelSupportsVision } from '../core/modelCapabilities';
import {
  buildToolResultCompactionInput,
  compactLargeToolResultsInThread,
  deterministicCompactToolResult,
} from '../services/llm/contextCompaction';
import { StreamingTextBuffer } from '../services/streaming/StreamingTextBuffer';
import { generateThreadTitle } from '../services/threadNamer';
import { buildRuntimeContext } from '../services/chat/runtimeContext';
import { logEvent } from '../services/diagnostics/chatLog';
import { logger } from '../services/diagnostics/logger';
import { createWorkspaceChatPersistence } from '../services/workspaceChatPersistence';
import {
  ChatPersistenceCoordinator,
  snapshotLatestUpdatedAt,
} from './chatPersistenceCoordinator';
import {
  executeToolBatch,
  type ToolStoreContext,
} from '../services/chat/toolBatchExecutor';
import {
  appendImageGenAddendum,
  effectiveContextMode,
  latestUserMessageContent,
  latestUserPromptBody,
  reservedOutputTokensForContextMode,
  systemPromptForContextMode,
  toolsForContextMode,
  wireMessagesForContextMode,
  type ChatContextMode,
} from '../services/chat/contextModes';
import { buildActivitiesForMessage } from '../services/chat/activityProjection';
import {
  formatOversizedContextMessage,
  formatProviderErrorRecovery,
  formatRepeatedSideEffectLoopMessage,
  formatToolRoundCapMessage,
  normalizeProviderErrorMessage,
} from '../services/chat/turnFormatting';
import {
  directImageComfyMode,
  estimatedImageDuration,
  imageBackendDisplayName,
} from '../services/chat/imageTurnFormatting';
import { extractLocalPseudoToolCalls } from '../services/chat/pseudoToolRescue';
import {
  OUTPUT_LIMIT_RETRY_ROUNDS,
  StreamingRoundExecutor,
  transientProviderRetryPolicy,
  type StreamingRoundActivityUpdate,
} from '../services/chat/streamingRoundExecutor';
import { threadLlmSpendUsd as threadSpendSelector } from '../core/threadSelectors';
import type { ProviderStore } from './ProviderStore';
import type { ModelRegistry } from './ModelRegistry';
import type { UserProfileStore } from './UserProfileStore';
import type { BridgeClientFacade } from '../services/tools/types';
import type { CompletedJob } from '../services/image/jobs/types';

export type { ChatContextMode } from '../services/chat/contextModes';
export { PROVIDER_STREAM_INITIAL_STALL_MS, PROVIDER_STREAM_STALL_MS } from '../services/chat/streamingRoundExecutor';
export type ChatThinkingEffort = Extract<ThinkingEffort, 'low' | 'medium' | 'high'>;
export const DEFAULT_OPENROUTER_THINKING_EFFORT: ChatThinkingEffort = 'low';
export const OPENROUTER_THINKING_PRESETS: Array<{ value: ChatThinkingEffort; label: string; title: string }> = [
  { value: 'low', label: 'fast', title: 'Fast: shorter reasoning for lower latency.' },
  { value: 'medium', label: 'balanced', title: 'Balanced: normal reasoning depth.' },
  { value: 'high', label: 'deep', title: 'Deep: more reasoning for harder tasks.' },
];

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function createEmptyThread(now = Date.now()): Thread {
  return {
    id: newId('t'),
    title: 'New conversation',
    subtitle: '',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [],
  };
}

function normalizeActiveThreadId(threads: Thread[], activeThreadId: string | null): string | null {
  if (activeThreadId && threads.some(thread => thread.id === activeThreadId && thread.deletedAt == null)) {
    return activeThreadId;
  }
  const visible = threads
    .filter(thread => thread.deletedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return visible[0]?.id ?? null;
}

function normalizeWorkNote(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_WORK_NOTE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_WORK_NOTE_CHARS).trimEnd()}\n\n[work note truncated]`;
}

function appendWorkNote(existing: string[] | undefined, note: string): string[] {
  const notes = existing ?? [];
  if (notes.some(item => item.trim() === note)) return notes;
  return [...notes, note].slice(-MAX_WORK_NOTES);
}

// Tool-call ids are the join key between provider deltas, UI activity rows,
// and tool-result messages. Some providers omit or repeat ids, so the store
// normalizes them before any result can be attached to the wrong call.
function uniqueToolCallIds(calls: ToolCall[], message: AssistantMessage, round: number): ToolCall[] {
  const seen = new Set<string>();
  for (const call of message.toolCalls ?? []) seen.add(call.id);
  for (const result of message.toolResults ?? []) seen.add(result.toolCallId);
  return calls.map((call, index) => {
    if (call.id && !seen.has(call.id)) {
      seen.add(call.id);
      return call;
    }
    const base = call.id || `${call.name || 'tool'}-call`;
    let next = `${base}-r${round}-${index}`;
    while (seen.has(next)) next = `${base}-r${round}-${index}-${Math.random().toString(36).slice(2, 5)}`;
    seen.add(next);
    return { ...call, id: next };
  });
}

function sideEffectSignature(call: ToolCall): string | null {
  if (call.name !== 'fs') return null;
  const action = String(call.arguments.action ?? '').toLowerCase();
  if (action !== 'write' && action !== 'append') return null;
  const path = typeof call.arguments.path === 'string' ? call.arguments.path.trim() : '';
  if (!path) return null;
  return `fs:${action}:${path.replace(/\\/g, '/').toLowerCase()}`;
}

// Repeated writes are usually a model retry loop after it already succeeded.
// Cap only identical side-effect signatures so read/search retries still have
// room to recover from validation or bridge errors.
function repeatedSideEffectLoop(calls: ToolCall[], message: AssistantMessage): { path: string; action: string } | null {
  const counts = new Map<string, number>();
  for (const call of message.toolCalls ?? []) {
    const signature = sideEffectSignature(call);
    if (!signature) continue;
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  for (const call of calls) {
    const signature = sideEffectSignature(call);
    if (!signature) continue;
    const nextCount = (counts.get(signature) ?? 0) + 1;
    counts.set(signature, nextCount);
    if (nextCount > REPEATED_SIDE_EFFECT_CALL_LIMIT) {
      return {
        path: typeof call.arguments.path === 'string' ? call.arguments.path : '/workspace/artifacts/',
        action: String(call.arguments.action ?? 'write'),
      };
    }
  }
  return null;
}

/** Hard cap on the number of tool-call rounds per user turn, to prevent infinite loops if a model keeps re-calling the same tool. */
const MAX_TOOL_ROUNDS = 16;
const MAX_WORK_NOTES = 8;
const MAX_WORK_NOTE_CHARS = 4000;
const REPEATED_SIDE_EFFECT_CALL_LIMIT = 3;
const COMPACTION_TRIGGER_FRACTION = 0.9;
const COMPACTION_MAX_TOKENS = 500;
const COMPACTION_MODELS = [
  'or-gemini-3.1-flash-lite',
  'or-gemini-3-flash',
] as const;
const COMPACTION_INSTRUCTION = [
  'Compact the tool result for future programmatic continuation.',
  'Preserve workspace paths, schemas, counts, date ranges, and migration-relevant facts.',
  'Return concise plain text only. No markdown preamble.',
].join(' ');

/**
 * Owns the chat domain: threads, the active selection, and live streaming.
 *
 * Each thread streams independently. Switching threads or browser tabs does
 * NOT cancel an in-flight reply — the response keeps writing into its
 * original thread's message and the user can switch back to find it complete
 * (or still streaming). This matches how serious chat apps work.
 *
 * Streaming state lives in two parallel maps keyed by `threadId`:
 *   - `streamingByThread`: `messageId` of the assistant message currently
 *     being written (observable so the UI can show per-thread indicators).
 *   - `controllersByThread`: the `AbortController` for that stream, used to
 *     cancel on explicit stop or on interrupt-and-resend.
 *
   * Tool-calling: a single user turn is stored as one assistant message even
   * when it takes multiple model/tool round trips. The model emits text +
   * tool_calls, we execute the tools, then re-stream until the model produces
   * a round with no tool calls (final reply).
 *
 * Persisted to localStorage via an autorun. Pure state + business logic —
 * no React, no DOM, no `fetch` (delegated to providers via the router).
 */
export class ChatStore {
  threads: Thread[] = [];
  activeThreadId: string | null = null;
  streamingByThread: Record<string, string> = {};
  streamActivityByThread: Record<string, StreamActivity> = {};
  /** Per-thread send/stream errors; only the active thread surfaces via `lastError`. */
  lastErrorByThread: Record<string, string> = {};
  /** Set when another tab writes chat storage; local saves pause until dismissed. */
  persistenceConflict: string | null = null;
  /** User-visible notice after an emergency compaction save. */
  compactionNotice: string | null = null;

  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private readonly profile: UserProfileStore;
  private readonly controllersByThread = new Map<string, AbortController>();
  private readonly roundExecutor = new StreamingRoundExecutor({ retryPolicy: transientProviderRetryPolicy });
  private readonly textBuffer = new StreamingTextBuffer();
  private readonly persistence: ChatPersistenceCoordinator;
  private workspacePersistenceHydrating = false;
  /**
   * Late-bound source of "Recent conversations" digests. Wired by RootStore
   * to a SummaryStore call; left unset in tests that don't care about
   * cross-thread context. Returning [] is fine — composeSystemPrompt
   * gracefully omits the section.
   */
  private recentSummariesProvider: (() => string[]) | null = null;
  /**
   * Late-bound supplier of the extra stores that tools need (notes, summary).
   * Wired by RootStore after construction so we don't push those constructor
   * deps through every test that builds a ChatStore. Falls back to throwing
   * a clear error if a tool is called without it being set.
   */
  private toolStoresProvider: (() => ToolStoreContext) | null = null;

  constructor(providers: ProviderStore, registry: ModelRegistry, profile: UserProfileStore) {
    this.providers = providers;
    this.registry = registry;
    this.profile = profile;
    const snapshot = loadSnapshot();
    if (snapshot) {
      this.applySnapshot(snapshot);
    } else {
      // First run / cleared storage: land in one empty untitled thread so the
      // user has somewhere to type. Composer is disabled by hasUsableProvider
      // until a key is configured.
      const thread = createEmptyThread();
      this.threads = [thread];
      this.activeThreadId = thread.id;
    }
    const snapshotLoadError = consumeSnapshotLoadError();
    if (snapshotLoadError && this.activeThreadId) {
      this.setThreadLastError(this.activeThreadId, snapshotLoadError);
    }
    setMultiTabWriteHandler(key => {
      if (key !== CHAT_SNAPSHOT_STORAGE_KEY) return;
      logger.warn('persistence', 'Chat autosave paused after cross-tab write', { key });
      runInAction(() => {
        this.persistenceConflict =
          'Another browser tab updated chat history. Saving is paused until you reload or dismiss this warning.';
      });
      this.persistence.pause();
      // Drop any save already queued for a microtask so it can't fire after the
      // pause and clobber the other tab's write.
      cancelPendingDeferredSnapshot();
    });
    setCompactionNoticeHandler(message => {
      logger.info('persistence', 'Emergency chat compaction notice shown', { message });
      runInAction(() => { this.compactionNotice = message; });
    });
    makeAutoObservable<this, 'providers' | 'registry' | 'profile' | 'controllersByThread' | 'roundExecutor' | 'textBuffer' | 'persistence' | 'workspacePersistenceHydrating' | 'recentSummariesProvider' | 'toolStoresProvider'>(this, {
      providers: false,
      registry: false,
      profile: false,
      controllersByThread: false,
      roundExecutor: false,
      textBuffer: false,
      persistence: false,
      workspacePersistenceHydrating: false,
      recentSummariesProvider: false,
      toolStoresProvider: false,
    });

    // The coordinator owns the throttled autosave, unload flush, and the
    // workspace save queue; the autorun it installs tracks `this.snapshot`
    // (plus deep thread fields) through the callback below.
    this.persistence = new ChatPersistenceCoordinator(() => this.snapshot);
    this.persistence.start();
  }

  dispose(): void {
    this.abortAllStreams();
    this.persistence.dispose();
  }

  get snapshot(): ChatSnapshot {
    return { threads: this.threads, activeThreadId: this.activeThreadId };
  }

  get activeThread(): Thread | null {
    return this.threads.find(t => t.id === this.activeThreadId) ?? null;
  }

  /** Error banner text for the active thread only. */
  get lastError(): string | null {
    return this.activeThreadId ? (this.lastErrorByThread[this.activeThreadId] ?? null) : null;
  }

  get llmSpendByThread(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const thread of this.threads) {
      const total = threadSpendSelector(thread);
      if (total > 0) out[thread.id] = total;
    }
    return out;
  }

  threadLlmSpendUsd(threadId: string | null | undefined): number {
    return threadId ? (this.llmSpendByThread[threadId] ?? 0) : 0;
  }

  async enableWorkspacePersistence(client: BridgeClientFacade): Promise<boolean> {
    if (this.workspacePersistenceHydrating) return false;
    this.workspacePersistenceHydrating = true;
    const persistence = createWorkspaceChatPersistence(client);
    try {
      const loaded = await persistence.load();
      if (loaded.kind === 'loaded') {
        const localSnapshot = this.snapshot;
        if (snapshotLatestUpdatedAt(localSnapshot) > snapshotLatestUpdatedAt(loaded.snapshot)) {
          logger.warn('persistence', 'kept newer local chat over older workspace copy', {
            localUpdatedAt: snapshotLatestUpdatedAt(localSnapshot),
            workspaceUpdatedAt: snapshotLatestUpdatedAt(loaded.snapshot),
          });
          runInAction(() => {
            if (this.activeThreadId) {
              this.setThreadLastError(
                this.activeThreadId,
                'Workspace history was older than local chat history, so GatesAI kept the newer local copy.',
              );
            }
          });
          await persistence.save(localSnapshot, 'local-newer-than-workspace');
        } else {
          runInAction(() => {
            this.applySnapshot(loaded.snapshot);
          });
          saveSnapshot(this.snapshot);
        }
      } else if (loaded.kind === 'malformed') {
        try {
          await persistence.backupMalformed(loaded.raw);
        } catch (err) {
          logger.warn('persistence', 'failed to back up malformed workspace chat snapshot', err);
        }
        await persistence.save(this.snapshot, 'localStorage-migration');
      } else {
        await persistence.save(this.snapshot, 'localStorage-migration');
      }
      this.persistence.attachWorkspacePersistence(persistence);
      return true;
    } catch (err) {
      logger.warn('persistence', 'workspace chat persistence unavailable', err);
      return false;
    } finally {
      this.workspacePersistenceHydrating = false;
    }
  }

  get isStreaming(): boolean {
    return this.activeThreadId !== null && this.activeThreadId in this.streamingByThread;
  }

  get streamingMessageId(): string | null {
    if (!this.activeThreadId) return null;
    return this.streamingByThread[this.activeThreadId] ?? null;
  }

  isMessageStreaming(messageId: string): boolean {
    for (const id of Object.values(this.streamingByThread)) {
      if (id === messageId) return true;
    }
    return false;
  }

  isThreadStreaming(threadId: string): boolean {
    return threadId in this.streamingByThread;
  }

  /**
   * Draft-independent intermediates for token usage. MobX caches this as long
   * as the active thread, model, system-prompt deps, and tool-availability
   * don't change. The keystroke-cascade hot path (`tokenUsage(draft)`) reuses
   * this cache and only adds the draft's own token cost — turning a
   * per-keystroke flatten + JSON.stringify(tools) into a cheap addition.
   *
   * Trade-off: tool gating uses only the latest sent user message, not the
   * unsent draft. Tool availability rarely flips mid-typing, and the meter
   * is already approximate; the saved work is worth a slightly stale tool
   * count while typing.
   */
  private get tokenUsageBase(): {
    window: number;
    isLocalImage: boolean;
    baseUsed: number;
  } {
    const thread = this.activeThread;
    const model = this.registry.findById(thread?.modelId ?? '') ?? this.registry.findById(DEFAULT_MODEL_ID);
    const window = contextWindowFor(model);
    if (!thread) return { window, isLocalImage: false, baseUsed: 0 };
    if (model?.providerId === 'local-image') {
      return { window, isLocalImage: true, baseUsed: 0 };
    }
    const latestUserText = latestUserMessageContent(thread);
    const extras = this.toolStoresProvider?.();
    const bridge = extras?.bridge;
    const mode = effectiveContextMode(thread, model);
    const tools = toolsForContextMode({
      mode,
      toolsAllowed: model?.supportsTools !== false,
      userText: latestUserText,
      bridgeOnline: bridge?.isOnline ?? false,
      imageGenAvailable: isImageGenerationAvailable(extras),
      webSearchAvailable: extras?.search?.braveReady ?? false,
    });
    const systemPrompt = systemPromptForContextMode(mode, () =>
      this.profile.composeSystemPrompt({
          runtimeContext: buildRuntimeContext({ bridge }),
          threadContext: mode === 'full' ? thread.threadContext : undefined,
          recentSummaries: mode === 'full' ? this.recentSummariesProvider?.() ?? [] : [],
        })
    );
    const baseUsed = estimateLlmPayloadTokens({
      systemPrompt,
      messages: wireMessagesForContextMode(thread, mode),
      tools,
      reservedOutputTokens: reservedOutputTokensForContextMode(mode),
    });
    return { window, isLocalImage: false, baseUsed };
  }

  tokenUsage(draftText: string): TokenUsage {
    const { window, isLocalImage, baseUsed } = this.tokenUsageBase;
    const thread = this.activeThread;
    if (!thread) return computeUsage(0, window);
    if (isLocalImage) {
      const prompt = (draftText.trim() || latestUserPromptBody(thread)).trim();
      const used = prompt
        ? estimateLlmPayloadTokens({ messages: [{ role: 'user', content: prompt }], reservedOutputTokens: 0 })
        : 0;
      return computeUsage(used, window);
    }
    // Add only the draft message's marginal cost — base already covers the
    // existing wire messages + system prompt + tools.
    const draftCost = draftText.trim()
      // 4 = MESSAGE_OVERHEAD_TOKENS in core/tokens. Kept in sync there.
      ? estimateTokens(draftText) + 4
      : 0;
    return computeUsage(baseUsed + draftCost, window);
  }

  selectThread(id: string): boolean {
    if (this.activeThreadId === id) return true;
    const thread = this.ensureThreadModel(id);
    if (!thread || thread.deletedAt != null) return false;
    // Selection is part of URL synchronization, so it must be synchronous.
    // Deferring this through View Transitions lets the router briefly see the
    // old active thread and can bounce the sidebar between conversations.
    this.activeThreadId = id;
    return true;
  }

  createThread(): string {
    const thread = createEmptyThread();
    this.threads.unshift(thread);
    this.activeThreadId = thread.id;
    return thread.id;
  }

  setThreadModel(threadId: string, modelId: string): void {
    this.updateThread(threadId, () => ({ modelId }));
  }

  setThreadContextMode(threadId: string, mode: ChatContextMode): void {
    this.updateThread(threadId, () => ({ contextMode: mode }));
  }

  setThreadThinkingEffort(threadId: string, effort: ChatThinkingEffort): void {
    this.updateThread(threadId, () => ({ thinkingEffort: effort }));
  }

  /**
   * Inject a provider for "Recent conversations" digests. Called once by
   * RootStore at boot; tests can either skip it (no recent section) or
   * pass a stub.
   */
  setRecentSummariesProvider(fn: () => string[]): void {
    this.recentSummariesProvider = fn;
  }

  /**
   * Wire the auxiliary stores tools depend on (notes, summary). Called once
   * by RootStore after all stores exist. Tests that don't exercise tools
   * needing these stores can skip wiring entirely.
   */
  setToolStoresProvider(fn: () => ToolStoreContext): void {
    this.toolStoresProvider = fn;
  }

  activitiesForMessage(message: AssistantMessage, options: { streaming?: boolean } = {}): ActivityItem[] {
    const ownerThreadId = this.threadIdForMessage(message.id);
    return buildActivitiesForMessage({
      message,
      streaming: options.streaming,
      ownerThreadId,
      extras: this.toolStoresProvider?.(),
      streamActivity: ownerThreadId ? this.streamActivityByThread[ownerThreadId] : undefined,
    });
  }

  recordActivityEvent(event: ActivityItem): void {
    const streamingIds = Object.keys(this.streamingByThread);
    if (streamingIds.length === 0) return;
    // Attach bridge/tool activity to the thread that is actually streaming,
    // not necessarily the sidebar-active thread (background streams).
    const threadId = (this.activeThreadId && this.streamingByThread[this.activeThreadId])
      ? this.activeThreadId
      : streamingIds[0];
    const messageId = this.streamingByThread[threadId];
    if (!messageId) return;
    const message = this.findMessage(threadId, messageId);
    if (!message || message.role !== 'assistant') return;
    const existing = message.activityEvents ?? [];
    if (existing.some(item => item.id === event.id)) return;
    message.activityEvents = [...existing, event].slice(-12);
  }

  async llmComplete(messages: Pick<LlmRequest['messages'][number], 'role' | 'content'>[], systemPrompt?: string): Promise<string> {
    const modelId = this.activeThread?.modelId ?? DEFAULT_MODEL_ID;
    const { provider, providerModelId } = this.providers.router.resolve(modelId);
    const controller = new AbortController();
    let text = '';

    for await (const chunk of provider.stream({
      modelId: providerModelId,
      messages,
      ...(systemPrompt ? { systemPrompt } : {}),
      temperature: 0.2,
      maxTokens: 240,
      tools: [],
    }, controller.signal)) {
      if (chunk.type === 'text') text += chunk.delta;
      if (chunk.type === 'done') {
        if (chunk.finishReason === 'error') throw new Error(chunk.error ?? 'LLM completion failed');
        break;
      }
    }

    return text.trim();
  }

  notifyImageJobTerminal(job: CompletedJob): void {
    // The image job card is the terminal-state surface. Posting a normal
    // assistant message here made completions look like out-of-order model
    // prose when jobs finished asynchronously.
    void job;
  }

  /**
   * Per-thread context appended to the system prompt under "About this
   * conversation:". Persists with the thread snapshot. No editor UI yet.
   */
  setThreadContext(threadId: string, context: string): void {
    this.updateThread(threadId, () => ({ threadContext: context }));
  }

  /**
   * Rename a thread. Used by the `thread` tool and any future inline-rename
   * UI. Sets `autoNamed: true` so `maybeAutoName` never overwrites manual titles.
   */
  renameThread(threadId: string, title: string): void {
    const next = title.trim();
    this.updateThread(threadId, () => ({
      title: next || 'Untitled conversation',
      autoNamed: true,
    }));
  }

  clearAllThreads(): void {
    this.abortAllStreams();
    const thread = createEmptyThread();
    this.threads = [thread];
    this.activeThreadId = thread.id;
    this.lastErrorByThread = {};
  }

  applyImportedSnapshot(snapshot: ChatSnapshot): void {
    this.abortAllStreams();
    this.applySnapshot(snapshot);
    this.streamActivityByThread = {};
    this.lastErrorByThread = {};
    this.persistenceConflict = null;
    this.persistence.resume();
    this.schedulePersistSnapshot(this.snapshot);
  }

  /**
   * Abort every in-flight stream and drop all streaming bookkeeping. Used when
   * the thread list is about to be wholesale replaced (clear-all, cross-tab
   * reload) so an abandoned `runTurn` can't keep appending tokens or fire
   * `maybeAutoName` into the freshly-loaded state.
   */
  private abortAllStreams(): void {
    for (const controller of this.controllersByThread.values()) controller.abort();
    this.controllersByThread.clear();
    this.textBuffer.cancelAll();
    this.streamingByThread = {};
  }

  clearThreadMemory(): void {
    this.threads.forEach(thread => {
      thread.threadContext = undefined;
      thread.summary = undefined;
      thread.summaryUpdatedAt = undefined;
      thread.summaryMessageCount = undefined;
    });
  }

  /** Threads visible in the sidebar — soft-deleted ones are filtered out. */
  get visibleThreads(): Thread[] {
    return this.threads.filter(t => t.deletedAt == null);
  }

  /**
   * Mark a thread as deleted. The thread stays in storage so undo can
   * restore it; sidebar lists exclude soft-deleted rows. Aborts any
   * in-flight stream on that thread first. If the deleted thread was
   * active, switches to the next visible thread (or creates a new empty
   * one if there are none left).
   */
  softDeleteThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return;
    // Stop any in-flight stream the same way an explicit interrupt does, so a
    // restored thread shows the `*[interrupted]*` / `*[no response]*` marker
    // instead of a silently truncated reply.
    if (this.isThreadStreaming(threadId)) {
      this.interruptThread(threadId);
    } else {
      const controller = this.controllersByThread.get(threadId);
      if (controller) {
        controller.abort();
        this.controllersByThread.delete(threadId);
      }
      this.textBuffer.cancel(threadId);
      delete this.streamingByThread[threadId];
    }
    this.updateThread(threadId, () => ({ deletedAt: Date.now() }));
    if (this.activeThreadId === threadId) {
      const next = this.visibleThreads[0];
      this.activeThreadId = next ? next.id : this.createThread();
    }
  }

  /** Restore a soft-deleted thread. No-op if it isn't deleted. */
  restoreThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt == null) return;
    this.updateThread(threadId, () => ({ deletedAt: undefined }));
  }

  toggleThreadPinned(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return;
    this.updateThread(threadId, current => ({ pinned: !current.pinned }));
  }

  branchFrom(threadId: string, messageId: string): string | null {
    const source = this.findThread(threadId);
    if (!source || source.deletedAt != null) return null;
    if (this.isThreadStreaming(source.id)) return null;
    const index = source.messages.findIndex(message => message.id === messageId);
    if (index < 0) return null;
    return this.createBranchThread(source, index);
  }

  branchThreadFromMessage(threadId: string, messageId: string): string | null {
    return this.branchFrom(threadId, messageId);
  }

  regenerate(threadId: string, messageId: string): string | null {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return null;
    if (this.isThreadStreaming(thread.id)) return null;
    const index = thread.messages.findIndex(message => message.id === messageId);
    const message = thread.messages[index];
    if (!message || message.role !== 'assistant') return null;
    const precedingUserIndex = findPrecedingUserIndex(thread.messages, index);
    if (precedingUserIndex < 0) return null;

    thread.messages.splice(index);
    thread.updatedAt = Date.now();
    this.startTurn(thread.id, true);
    return thread.id;
  }

  regenerateFromMessage(threadId: string, messageId: string): string | null {
    return this.regenerate(threadId, messageId);
  }

  editAndResend(threadId: string, messageId: string, text: string): string | null {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return null;
    if (this.isThreadStreaming(thread.id)) return null;
    const index = thread.messages.findIndex(message => message.id === messageId);
    const original = thread.messages[index];
    const trimmed = text.trim();
    if (!original || original.role !== 'user' || !trimmed) return null;

    original.content = trimmed;
    thread.messages.splice(index + 1);
    thread.updatedAt = Date.now();
    this.startTurn(thread.id, true);
    return thread.id;
  }

  editAndResendFromMessage(threadId: string, messageId: string, text: string): string | null {
    return this.editAndResend(threadId, messageId, text);
  }

  /**
   * Send a user message on the active thread, then begin the model→tool loop.
   *
   * If a reply is already streaming on this thread, it's interrupted first:
   * the partial assistant message is annotated `*[interrupted]*` (so future
   * turns don't see a half-thought as if it were complete) and a fresh
   * stream is started for the new turn. Other threads' streams are untouched.
   */
  sendMessage(text: string, attachments: { id?: string; filename: string; path: string; size: number; mime: string }[] = []): void {
    const thread = this.ensureThreadModel(this.activeThreadId);
    const trimmed = text.trim();
    if (!thread || (!trimmed && attachments.length === 0)) return;

    const isReplacingInterruptedReply = this.isThreadStreaming(thread.id);
    if (this.isThreadStreaming(thread.id)) {
      this.interruptThread(thread.id);
    }

    this.setThreadLastError(thread.id, null);

    const attachmentFooter = formatAttachmentFooter(attachments);
    const refs = attachments.map(toMessageAttachmentRef);

    const userMessage: Message = {
      id: newId('m'),
      role: 'user',
      content: (trimmed + attachmentFooter).trim() || '(see attachments)',
      createdAt: Date.now(),
      ...(refs.length > 0 ? { attachments: refs } : {}),
    };
    this.appendMessage(thread.id, userMessage);

    const targetThreadId = thread.id;
    const controller = new AbortController();
    this.controllersByThread.set(targetThreadId, controller);

    this.runTurn(targetThreadId, controller.signal, isReplacingInterruptedReply)
      .catch(err => runInAction(() => {
        logger.error('chat', 'runTurn failed', { threadId: targetThreadId, err });
        this.setThreadLastError(targetThreadId, (err as Error).message);
        if (this.controllersByThread.get(targetThreadId) === controller) {
          this.clearStreamingState(targetThreadId);
        }
      }));
  }

  private startTurn(threadId: string, isReplacingInterruptedReply = false): void {
    const thread = this.ensureThreadModel(threadId);
    if (!thread || thread.messages.length === 0) return;
    if (this.isThreadStreaming(thread.id)) this.interruptThread(thread.id);
    this.activeThreadId = thread.id;
    this.setThreadLastError(thread.id, null);
    const controller = new AbortController();
    this.controllersByThread.set(thread.id, controller);
    this.runTurn(thread.id, controller.signal, isReplacingInterruptedReply)
      .catch(err => runInAction(() => {
        logger.error('chat', 'runTurn failed', { threadId: thread.id, err });
        this.setThreadLastError(thread.id, (err as Error).message);
        if (this.controllersByThread.get(thread.id) === controller) {
          this.clearStreamingState(thread.id);
        }
      }));
  }

  stopStreaming(): void {
    if (!this.activeThreadId) return;
    if (!this.isThreadStreaming(this.activeThreadId)) return;
    this.interruptThread(this.activeThreadId);
  }

  private interruptThread(threadId: string): void {
    const messageId = this.streamingByThread[threadId];
    const controller = this.controllersByThread.get(threadId);
    if (controller) controller.abort();

    if (messageId) {
      this.textBuffer.flush(messageId);
      const message = this.findMessage(threadId, messageId);
      if (message && message.role === 'assistant') {
        const partial = message.content.trim();
        message.content = partial ? `${message.content}\n\n*[interrupted]*` : '*[no response]*';
      }
    }
    this.clearStreamingState(threadId);
  }

  private clearStreamingState(threadId: string, expectedMessageId?: string): void {
    if (expectedMessageId && this.streamingByThread[threadId] !== expectedMessageId) return;
    delete this.streamingByThread[threadId];
    delete this.streamActivityByThread[threadId];
    this.controllersByThread.delete(threadId);
  }

  /**
   * True while this message still owns the active stream slot for the thread.
   * After interrupt-and-resend or `clearStreamingState`, abandoned `runTurn`
   * work must not write tokens, set finishReason, or call `maybeAutoName`.
   */
  private ownsStreamingTurn(threadId: string, messageId: string): boolean {
    return this.streamingByThread[threadId] === messageId;
  }

  private applyRoundActivityUpdate(threadId: string, messageId: string, update: StreamingRoundActivityUpdate): void {
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
    runInAction(() => {
      const existing = this.streamActivityByThread[threadId];
      if (update.phase === 'connecting') {
        this.streamActivityByThread[threadId] = {
          messageId,
          phase: 'connecting',
          startedAt: existing?.startedAt ?? update.at,
          lastProviderAt: update.at,
          round: update.round,
          providerId: update.providerId,
          providerModelId: update.providerModelId,
        };
        return;
      }
      if (!existing || existing.messageId !== messageId || existing.phase === 'stalled') return;
      this.streamActivityByThread[threadId] = {
        ...existing,
        phase: update.phase,
        lastProviderAt: update.phase === 'stalled' ? existing.lastProviderAt : update.at,
        stallReason: update.phase === 'stalled' ? update.stallReason : undefined,
      };
    });
  }

  private markStreamActivityPhase(threadId: string, messageId: string, phase: StreamActivity['phase']): void {
    if (!this.ownsStreamingTurn(threadId, messageId)) return;
    runInAction(() => {
      const existing = this.streamActivityByThread[threadId];
      if (!existing || existing.messageId !== messageId || existing.phase === 'stalled') return;
      this.streamActivityByThread[threadId] = {
        ...existing,
        phase,
        lastProviderAt: Date.now(),
        stallReason: undefined,
      };
    });
  }

  private ensureThreadModel(threadId: string | null): Thread | null {
    if (!threadId) return null;
    const thread = this.findThread(threadId);
    if (!thread) return null;
    if (this.registry.findById(thread.modelId)) return thread;
    thread.modelId = DEFAULT_MODEL_ID;
    return thread;
  }

  /**
   * Drive a single user turn from start to finish.
   *
   * One user turn = ONE stored {@link AssistantMessage}, no matter how
   * many model→tool round trips happen along the way. The message
   * accumulates `toolCalls` and `toolResults` across rounds and ends with
   * `content` set to the model's final prose. The renderer sees one
   * speaker boundary per turn — no continuation/kicker-suppression hacks
   * needed because there are no continuations.
   *
   * Each round:
   *   1. wipe `content` to '' (so streamed prose from a non-final round
   *      doesn't linger as the final answer if the model decides to call
   *      another tool)
   *   2. stream from the provider; append tokens to `content`, collect
   *      tool calls
   *   3. if no calls came back: this WAS the final round, exit
   *   4. otherwise: preserve the round's prose in `workNotes` for visible
   *      rendering, clear `content` for the next round's final prose, append
   *      the calls to `toolCalls`, execute them, append to `toolResults`, loop
   *
   * The loop exits when the model produces a round with no tool calls
   * (final reply), the request errors, the signal aborts, or we hit
   * {@link MAX_TOOL_ROUNDS}.
   */
  private async runTurn(threadId: string, signal: AbortSignal, isReplacingInterruptedReply = false): Promise<void> {
    const thread = this.findThread(threadId);
    if (!thread) return;

    const assistantMessage: AssistantMessage = {
      id: newId('m'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: thread.modelId,
      preTokenLabel: isReplacingInterruptedReply ? 'responding' : 'thinking',
    };
    runInAction(() => {
      this.appendMessage(threadId, assistantMessage);
      this.streamingByThread[threadId] = assistantMessage.id;
    });

    logEvent(thread.id, 'turn.start', {
      modelId: thread.modelId,
      lastUserText: latestUserMessageContent(thread).slice(0, 200),
    });

    // Direct-image short-circuit: when the active model is the synthetic
    // 'local-image' provider, skip the LLM entirely. The user's prompt
    // becomes the image prompt; we enqueue a job and attach the artifact.
    // This is the offline path — works with no internet at all.
    const activeModel = this.registry.findById(thread.modelId);
    if (activeModel?.providerId === 'local-image') {
      this.runDirectImageTurn(thread, assistantMessage);
      return;
    }

    let outputLimitRetries = 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) return;

      let provider: LlmProvider;
      let providerModelId: string;
      try {
        ({ provider, providerModelId } = this.providers.router.resolve(thread.modelId));
      } catch (err) {
        const msg = (err as Error).message;
        logger.warn('chat', 'model resolve failed', { threadId, modelId: thread.modelId, error: msg });
        logEvent(thread.id, 'round.resolveError', { round, modelId: thread.modelId, error: msg });
        this.textBuffer.flush(assistantMessage.id);
        runInAction(() => {
          this.setThreadLastError(threadId, msg);
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            m.content = `_Error: ${msg}_`;
            this.touchMessage(threadId, assistantMessage.id);
          }
          this.clearStreamingState(threadId, assistantMessage.id);
        });
        return;
      }
      logEvent(thread.id, 'round.start', { round, providerId: provider.id, providerModelId });
      const recentSummaries = this.recentSummariesProvider?.() ?? [];
      let request = this.buildTurnRequest(thread, providerModelId, recentSummaries);
      if (hasAnyImageAttachment(thread.messages)) {
        await this.inlineImageAttachments(thread, request);
      }
      const contextWindow = contextWindowFor(this.registry.findById(thread.modelId));
      let requestedTokens = estimateLlmPayloadTokens({
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        tools: request.tools,
        reservedOutputTokens: request.maxTokens,
      });
      if (requestedTokens > contextWindow * COMPACTION_TRIGGER_FRACTION) {
        runInAction(() => {
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant' && !m.content.trim()) m.preTokenLabel = 'compacting';
        });
        await this.compactThreadContext(thread, signal);
        if (signal.aborted) {
          runInAction(() => this.clearStreamingState(threadId, assistantMessage.id));
          return;
        }
        runInAction(() => {
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant' && !m.content.trim()) {
            m.preTokenLabel = isReplacingInterruptedReply ? 'responding' : 'thinking';
          }
        });
        request = this.buildTurnRequest(thread, providerModelId, recentSummaries);
        if (hasAnyImageAttachment(thread.messages)) {
          await this.inlineImageAttachments(thread, request);
        }
        requestedTokens = estimateLlmPayloadTokens({
          systemPrompt: request.systemPrompt,
          messages: request.messages,
          tools: request.tools,
          reservedOutputTokens: request.maxTokens,
        });
      }
      if (requestedTokens > contextWindow) {
        const message = formatOversizedContextMessage(requestedTokens, contextWindow);
        runInAction(() => {
          this.setThreadLastError(threadId, message);
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            m.content = message;
            this.touchMessage(threadId, assistantMessage.id);
          }
          this.clearStreamingState(threadId, assistantMessage.id);
        });
        return;
      }

      const outcome = await this.roundExecutor.execute({
        request,
        stream: provider.stream.bind(provider),
        signal,
        round,
        providerId: provider.id,
        providerModelId,
        callbacks: {
          onActivityPhase: update => this.applyRoundActivityUpdate(threadId, assistantMessage.id, update),
          onChunk: delta => {
            if (!this.ownsStreamingTurn(threadId, assistantMessage.id)) return;
            this.queueTextChunk(threadId, assistantMessage.id, delta);
          },
        },
      });

      const collectedCalls = outcome.toolCalls;
      const collectedUsage = outcome.usage;
      const errored = outcome.status === 'errored' || outcome.status === 'stalled';
      const errorMessage = errored ? outcome.error : undefined;
      const finishReason: AssistantFinishReason | undefined = errored
        ? 'error'
        : outcome.status === 'completed'
          ? outcome.finishReason
          : undefined;

      if (outcome.status === 'aborted') {
        this.textBuffer.flush(assistantMessage.id);
        runInAction(() => this.clearStreamingState(threadId, assistantMessage.id));
        return;
      }

      if (outcome.status === 'completed') {
        logEvent(thread.id, 'round.done', { round, finishReason: outcome.finishReason });
      } else if (outcome.status === 'stalled') {
        logEvent(thread.id, 'round.done', { round, finishReason: 'error', error: outcome.error });
      } else {
        logEvent(thread.id, 'round.exception', { round, error: outcome.error });
        logger.error('chat', 'provider stream exception', { threadId, round, err: outcome.cause ?? outcome.error });
      }

      if (collectedUsage.length > 0) {
        runInAction(() => {
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            m.usage = [...(m.usage ?? []), ...collectedUsage];
          }
        });
      }

      if (errored && errorMessage) {
        this.textBuffer.flush(assistantMessage.id);
        if (!this.ownsStreamingTurn(threadId, assistantMessage.id)) {
          logger.warn('chat', 'skipped stale turn error finalization', {
            threadId,
            messageId: assistantMessage.id,
          });
        } else {
          runInAction(() => {
            this.setThreadLastError(threadId, errorMessage ?? 'unknown error');
            const m = this.findMessage(threadId, assistantMessage.id);
            if (m && m.role === 'assistant') {
              m.finishReason = 'error';
              const recovery = formatProviderErrorRecovery(m, errorMessage ?? 'unknown error');
              m.content = m.content.trim()
                ? `${m.content.trimEnd()}\n\n${recovery}`
                : recovery;
              this.touchMessage(threadId, assistantMessage.id);
            }
          });
        }
      }

      if (!errored && collectedCalls.length === 0 && activeModel?.providerId === 'ollama' && request.tools?.length) {
        this.textBuffer.flush(assistantMessage.id);
        const m = this.findMessage(threadId, assistantMessage.id);
        const rescuedCalls = m?.role === 'assistant'
          ? uniqueToolCallIds(extractLocalPseudoToolCalls(m.content), m, round)
          : [];
        if (rescuedCalls.length > 0) {
          const repeat = m?.role === 'assistant' ? repeatedSideEffectLoop(rescuedCalls, m) : null;
          if (repeat) {
            runInAction(() => {
              if (m && m.role === 'assistant') {
                const note = normalizeWorkNote(m.content);
                if (note) m.workNotes = appendWorkNote(m.workNotes, note);
                m.content = formatRepeatedSideEffectLoopMessage(repeat);
                this.touchMessage(threadId, assistantMessage.id);
                this.clearStreamingState(threadId, assistantMessage.id);
              }
            });
            return;
          }
          logEvent(thread.id, 'tool.rescue.detected', {
            round,
            count: rescuedCalls.length,
            toolNames: rescuedCalls.map(call => call.name),
          });
          runInAction(() => {
            if (m && m.role === 'assistant') {
              const note = normalizeWorkNote(m.content);
              if (note) m.workNotes = appendWorkNote(m.workNotes, note);
              m.content = '';
              m.toolCalls = [...(m.toolCalls ?? []), ...rescuedCalls];
            }
          });
          this.textBuffer.cancel(assistantMessage.id);
          this.markStreamActivityPhase(threadId, assistantMessage.id, 'tooling');
          const results = await this.executeToolCalls(rescuedCalls, threadId, signal);
          if (signal.aborted) {
            runInAction(() => {
              const current = this.findMessage(threadId, assistantMessage.id);
              if (current && current.role === 'assistant' && results.length > 0) {
                current.toolResults = [...(current.toolResults ?? []), ...results];
              }
              this.clearStreamingState(threadId, assistantMessage.id);
            });
            return;
          }
          runInAction(() => {
            const current = this.findMessage(threadId, assistantMessage.id);
            if (current && current.role === 'assistant') {
              current.toolResults = [...(current.toolResults ?? []), ...results];
            }
          });
          continue;
        }
      }

      if (!errored && collectedCalls.length === 0 && finishReason === 'length') {
        this.textBuffer.flush(assistantMessage.id);
        const current = this.findMessage(threadId, assistantMessage.id);
        const hasProgress = Boolean(
          current
          && current.role === 'assistant'
          && ((current.toolResults?.length ?? 0) > 0 || (current.workNotes?.length ?? 0) > 0),
        );
        const hasVisibleText = Boolean(current && current.role === 'assistant' && current.content.trim());
        if (hasProgress && !hasVisibleText && outputLimitRetries < OUTPUT_LIMIT_RETRY_ROUNDS) {
          outputLimitRetries += 1;
          logEvent(thread.id, 'round.lengthRetry', { round, outputLimitRetries });
          runInAction(() => {
            if (current && current.role === 'assistant') {
              current.finishReason = undefined;
              this.touchMessage(threadId, assistantMessage.id);
            }
          });
          continue;
        }
      }

      if (errored || collectedCalls.length === 0) {
        this.textBuffer.flush(assistantMessage.id);
        // Final round (no calls) or terminal error — keep whatever prose
        // was streamed and stop.
        if (this.ownsStreamingTurn(threadId, assistantMessage.id)) {
          runInAction(() => {
            const m = this.findMessage(threadId, assistantMessage.id);
            if (m && m.role === 'assistant' && finishReason) {
              m.finishReason = finishReason;
            }
            if (finishReason === 'content_filter') {
              this.setThreadLastError(threadId, 'The provider filtered this response before it finished.');
            }
            this.touchMessage(threadId, assistantMessage.id);
            this.clearStreamingState(threadId, assistantMessage.id);
          });
          this.maybeAutoName(threadId, assistantMessage);
        }
        return;
      }

      const currentForTools = this.findMessage(threadId, assistantMessage.id);
      const toolMessage = currentForTools && currentForTools.role === 'assistant' ? currentForTools : assistantMessage;
      const uniqueCollectedCalls = uniqueToolCallIds(collectedCalls, toolMessage, round);
      const repeat = repeatedSideEffectLoop(uniqueCollectedCalls, toolMessage);
      if (repeat) {
        this.textBuffer.flush(assistantMessage.id);
        if (this.ownsStreamingTurn(threadId, assistantMessage.id)) {
          runInAction(() => {
            const m = this.findMessage(threadId, assistantMessage.id);
            if (m && m.role === 'assistant') {
              const note = normalizeWorkNote(m.content);
              if (note) m.workNotes = appendWorkNote(m.workNotes, note);
              m.content = formatRepeatedSideEffectLoopMessage(repeat);
              this.touchMessage(threadId, assistantMessage.id);
            }
            this.clearStreamingState(threadId, assistantMessage.id);
          });
          this.maybeAutoName(threadId, assistantMessage);
        }
        return;
      }

      // Mid-turn: the model called tools. Keep any streamed pre-tool prose as
      // visible work notes, then clear `content` so the next streamed text is
      // the model's closing reply after tool results are available.
      this.textBuffer.flush(assistantMessage.id);
      if (signal.aborted) {
        runInAction(() => this.clearStreamingState(threadId, assistantMessage.id));
        return;
      }
      runInAction(() => {
        const m = this.findMessage(threadId, assistantMessage.id);
        if (m && m.role === 'assistant') {
          const note = normalizeWorkNote(m.content);
          if (note) m.workNotes = appendWorkNote(m.workNotes, note);
          m.content = '';
          m.toolCalls = [...(m.toolCalls ?? []), ...uniqueCollectedCalls];
        }
      });
      this.textBuffer.cancel(assistantMessage.id);

      this.markStreamActivityPhase(threadId, assistantMessage.id, 'tooling');
      const results = await this.executeToolCalls(uniqueCollectedCalls, threadId, signal);
      if (signal.aborted) {
        runInAction(() => {
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant' && results.length > 0) {
            m.toolResults = [...(m.toolResults ?? []), ...results];
          }
          this.clearStreamingState(threadId, assistantMessage.id);
        });
        return;
      }
      runInAction(() => {
        const m = this.findMessage(threadId, assistantMessage.id);
        if (m && m.role === 'assistant') {
          m.toolResults = [...(m.toolResults ?? []), ...results];
        }
      });
    }

    runInAction(() => {
      this.textBuffer.cancel(assistantMessage.id);
      const current = this.findMessage(threadId, assistantMessage.id);
      const message = formatToolRoundCapMessage(MAX_TOOL_ROUNDS, current && current.role === 'assistant' ? current : assistantMessage);
      this.setThreadLastError(threadId, message);
      if (current && current.role === 'assistant') {
        current.content = message;
        this.touchMessage(threadId, assistantMessage.id);
      }
      this.clearStreamingState(threadId, assistantMessage.id);
    });
  }

  private buildTurnRequest(thread: Thread, providerModelId: string, recentSummaries: string[]): LlmRequest {
    const extras = this.toolStoresProvider?.();
    const bridge = extras?.bridge;
    const model = this.registry.findById(thread.modelId);
    const mode = effectiveContextMode(thread, model);
    const systemPrompt = systemPromptForContextMode(mode, () =>
      this.profile.composeSystemPrompt({
          runtimeContext: buildRuntimeContext({ bridge }),
          threadContext: mode === 'full' ? thread.threadContext : undefined,
          recentSummaries: mode === 'full' ? recentSummaries : [],
        })
    );
    const tools = toolsForContextMode({
      mode,
      toolsAllowed: model?.supportsTools !== false,
      userText: latestUserMessageContent(thread),
      bridgeOnline: bridge?.isOnline ?? false,
      imageGenAvailable: isImageGenerationAvailable(extras),
      webSearchAvailable: extras?.search?.braveReady ?? false,
    });
    const finalSystemPrompt = appendImageGenAddendum(systemPrompt, tools);
    const maxTokens = reservedOutputTokensForContextMode(mode);
    return {
      modelId: providerModelId,
      messages: wireMessagesForContextMode(thread, mode),
      ...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
      ...(tools ? { tools } : {}),
      ...(maxTokens != null ? { maxTokens } : {}),
      ...(model?.providerId === 'openrouter' ? { thinkingEffort: normalizeOpenRouterThinkingEffort(thread.thinkingEffort) } : {}),
      threadId: thread.id,
    };
  }

  /**
   * If the thread carries any image attachments AND the target model
   * supports vision AND the bridge is available, resolve the base64
   * bytes and inline them onto the wire messages. Callers gate this on
   * {@link hasAnyImageAttachment} so the common no-image path avoids
   * the microtask an unconditional `await` would add — several
   * streaming tests rely on the turn's startup being fully synchronous
   * up to the first `provider.stream` chunk.
   */
  private async inlineImageAttachments(thread: Thread, request: LlmRequest): Promise<void> {
    const bridge = this.toolStoresProvider?.().bridge;
    const model = this.registry.findById(thread.modelId);
    if (!bridge || !model || !modelSupportsVision(model)) return;
    await resolveWireImages(request.messages, thread.messages, bridge, true);
  }

  private async compactThreadContext(thread: Thread, signal: AbortSignal): Promise<void> {
    await compactLargeToolResultsInThread(thread, {
      replaceContent: (result, content) => {
        runInAction(() => {
          result.content = content;
        });
      },
      compactOne: async (result) => {
        if (signal.aborted) return deterministicCompactToolResult(result);
        const modelCompaction = await this.compactToolResultWithModel(result, signal);
        return modelCompaction ?? deterministicCompactToolResult(result);
      },
    });
  }

  private async compactToolResultWithModel(result: ToolResult, signal: AbortSignal): Promise<string | null> {
    const picked = this.pickCompactionModel();
    if (!picked) return null;

    const request: LlmRequest = {
      modelId: picked.providerModelId,
      systemPrompt: COMPACTION_INSTRUCTION,
      messages: [{ role: 'user', content: buildToolResultCompactionInput(result) }],
      maxTokens: COMPACTION_MAX_TOKENS,
      temperature: 0.2,
      tools: [],
    };

    let acc = '';
    try {
      for await (const chunk of picked.provider.stream(request, signal)) {
        if (signal.aborted) return null;
        if (chunk.type === 'text') acc += chunk.delta;
        if (chunk.type === 'done') {
          if (chunk.finishReason === 'error') return null;
          break;
        }
      }
    } catch {
      return null;
    }

    const trimmed = acc.trim();
    if (!trimmed) return null;
    return [
      `tool: ${result.toolName}`,
      `original_chars: ${result.content.length}`,
      'model_summary:',
      trimmed,
    ].join('\n');
  }

  private pickCompactionModel(): { provider: LlmProvider; providerModelId: string } | null {
    for (const modelId of COMPACTION_MODELS) {
      const model = this.registry.findById(modelId);
      if (!model) continue;
      try {
        const resolved = this.providers.router.resolve(modelId);
        if (resolved.provider.ready()) return resolved;
      } catch {
        // No usable provider for this model — try the next.
        continue;
      }
    }
    return null;
  }

  /**
   * Fire-and-forget auto-name on the first successful turn. We pass the
   * opening user message + the just-completed assistant reply through
   * the namer cascade. The `naming` flag is set transiently for the UI
   * typewriter animation and cleared whether or not the namer succeeds.
   *
   * Skipped if there's no opening user message, or the thread's title is
   * locked via `autoNamed`. `autoNamed` is set both after a successful
   * auto-name and by `renameThread` (the `thread` tool / any future inline
   * rename), so a user/tool-chosen title is never overwritten. The truncated
   * provisional title set in `appendMessage` is intentionally *not* locked, so
   * the first completed turn upgrades it to a real title.
   */
  private maybeAutoName(threadId: string, assistantMessage: AssistantMessage): void {
    // NOTE: callers verify stream ownership *before* finalizing and clearing
    // streaming state, then call this. We must NOT re-check `ownsStreamingTurn`
    // here — by this point `clearStreamingState` has already run, so the check
    // would always fail and silently disable auto-naming entirely.
    const thread = this.findThread(threadId);
    // Skip if already named, currently naming (a second completed turn must not
    // launch a parallel namer — flicker + wasted API calls), or soft-deleted (a
    // returning namer would otherwise resurrect a title onto a deleted thread).
    if (!thread || thread.autoNamed || thread.naming || thread.deletedAt != null) return;
    if (!this.providers.router.canRoute()) return;
    const opener = thread.messages.find(m => m.role === 'user');
    if (!opener) return;

    // Strip any error suffix the stream appended so we don't name from "_Error: …_".
    const assistantText = assistantMessage.content.replace(/\n\n_Error:[^]*$/s, '').trim();

    runInAction(() => { thread.naming = true; });
    void generateThreadTitle(
      {
        userText: opener.content,
        assistantText,
        fallbackModelId: thread.modelId,
      },
      this.providers.router,
    ).then(title => runInAction(() => {
      thread.naming = false;
      // Re-check the lock + deletion: a manual `renameThread` (tool/UI) could
      // have landed, or the thread could have been soft-deleted, while the async
      // namer was in flight; never clobber a chosen title or revive a dead thread.
      if (title && !thread.autoNamed && thread.deletedAt == null) {
        thread.title = title;
        thread.autoNamed = true;
      }
    })).catch(err => {
      // Auto-naming is best-effort, but a silent swallow hid real failures
      // (e.g. every cheap model rejecting the request). Log it so a broken
      // namer is visible during harness iteration; the thread keeps its
      // fallback title either way.
      logger.warn('chat', 'auto-naming failed; keeping fallback title', err);
      runInAction(() => { thread.naming = false; });
    });
  }

  private async executeToolCalls(calls: ToolCall[], threadId: string, signal: AbortSignal): Promise<ToolResult[]> {
    return executeToolBatch(calls, threadId, signal, {
      profile: this.profile,
      chat: this,
      extras: this.toolStoresProvider?.() ?? ({} as ToolStoreContext),
    });
  }

  /**
   * Direct-image-only turn: bypass the LLM and enqueue an image-job using
   * the latest user message as the prompt. This is the path the synthetic
   * `'local-image'` provider model uses — no network, no chat round-trip.
   *
   * The assistant message gets a brief one-line acknowledgment plus an
   * `image-job` artifact that the existing `ImageJobCard` renders for live
   * progress and the final image.
   */
  private runDirectImageTurn(thread: Thread, assistantMessage: AssistantMessage): void {
    const stores = this.toolStoresProvider?.();
    const imageJobs = stores?.imageJobs;
    const imageGen = stores?.imageGen;
    const comfyReady = stores?.localRuntime?.comfyReady ?? false;
    const prompt = latestUserPromptBody(thread).trim();

    runInAction(() => {
      const message = this.findMessage(thread.id, assistantMessage.id);
      if (!message || message.role !== 'assistant') {
        this.clearStreamingState(thread.id, assistantMessage.id);
        return;
      }
      if (!prompt) {
        message.content = '_Direct image mode: no prompt found in your last message._';
        this.touchMessage(thread.id, message.id);
        this.clearStreamingState(thread.id, assistantMessage.id);
        return;
      }
      if (!imageJobs || !imageGen) {
        message.content = '_Direct image mode: image-jobs subsystem not wired in this session._';
        this.touchMessage(thread.id, message.id);
        this.clearStreamingState(thread.id, assistantMessage.id);
        return;
      }
      // Defense in depth: the picker hides direct-image models and the composer
      // blocks send unless ComfyUI is ready, but never silently enqueue a job
      // against an unavailable backend if a turn slips through.
      if (!comfyReady) {
        message.content = '_Direct image mode: ComfyUI is not running. Start and connect it in Local settings, then try again._';
        this.touchMessage(thread.id, message.id);
        this.clearStreamingState(thread.id, assistantMessage.id);
        return;
      }

      const activeModel = this.registry.findById(thread.modelId);
      // Direct-image models are ComfyUI modes by construction (Draft / Normal /
      // Upscale). Force the local-comfy backend and always derive the mode so
      // the render matches what the picker promised, regardless of the global
      // image-backend preference.
      const backend = 'local-comfy' as const;
      const comfyMode = directImageComfyMode(activeModel?.providerModelId);
      const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'render';
      const { jobId, count } = imageJobs.enqueue({
        threadId: thread.id,
        prompt,
        count: 1,
        // Local backends prefer their workflow's native res; let the
        // backend decide its own dims when no explicit override is given.
        // We pick a sensible default 1024x1024 — the workflow's
        // EmptyFlux2LatentImage will use these.
        width: 1024,
        height: 1024,
        backend,
        comfyMode,
        filenamePrefix: slug,
      });

      // Attach the image-job artifact via a synthetic tool-call/result
      // pair so EditorialMessage's existing artifact pipeline picks it up.
      const callId = newId('tc');
      const backendLabel = imageBackendDisplayName(backend);
      const estimate = estimatedImageDuration(backend);
      message.content = `I queued an image through ${backendLabel}. It usually takes ${estimate}; I’ll drop the finished image here when it’s ready.`;
      message.preTokenLabel = undefined;
      message.toolCalls = [{
        id: callId,
        name: 'image_generate',
        arguments: { prompt },
      }];
      message.toolResults = [{
        toolCallId: callId,
        toolName: 'image_generate',
        content: `Queued an image render through ${backendLabel} (job ${jobId}). Expected time: ${estimate}.`,
        summary: `Queued image render through ${backendLabel}.`,
        ranAt: Date.now(),
        artifacts: [{ kind: 'image-job', jobId, count }],
      }];
      this.touchMessage(thread.id, message.id);
      this.clearStreamingState(thread.id, assistantMessage.id);
    });
  }

  private findThread(id: string): Thread | undefined {
    return this.threads.find(t => t.id === id);
  }

  private applySnapshot(snapshot: ChatSnapshot): void {
    this.threads = snapshot.threads.map(thread =>
      this.registry.findById(thread.modelId)
        ? thread
        : { ...thread, modelId: DEFAULT_MODEL_ID }
    );
    this.activeThreadId = normalizeActiveThreadId(this.threads, snapshot.activeThreadId);
    if (!this.activeThreadId) {
      const thread = createEmptyThread();
      this.threads = [thread];
      this.activeThreadId = thread.id;
    }
  }

  private schedulePersistSnapshot(snapshot: ChatSnapshot): void {
    this.persistence.schedule(snapshot);
  }

  private findMessage(threadId: string, messageId: string): Message | undefined {
    return this.findThread(threadId)?.messages.find(m => m.id === messageId);
  }

  private threadIdForMessage(messageId: string): string | undefined {
    return this.threads.find(thread => thread.messages.some(message => message.id === messageId))?.id;
  }

  private createBranchThread(source: Thread, throughIndex: number): string | null {
    const now = Date.now();
    const through = Math.max(-1, Math.min(throughIndex, source.messages.length - 1));
    const messages = through >= 0 ? cloneMessagesForBranch(source.messages.slice(0, through + 1)) : [];
    const branch: Thread = {
      id: newId('t'),
      title: branchTitle(source.title),
      subtitle: source.subtitle,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      modelId: source.modelId,
      messages,
      ...(source.contextMode ? { contextMode: source.contextMode } : {}),
      ...(source.thinkingEffort ? { thinkingEffort: source.thinkingEffort } : {}),
    };
    this.threads.unshift(branch);
    return branch.id;
  }

  private appendMessage(threadId: string, message: Message): void {
    const thread = this.findThread(threadId);
    // Never write into a soft-deleted thread. A turn aborted by soft-delete can
    // still have async tool results / image-job notifications in flight; letting
    // them land would resurrect content if the user later hits Undo.
    if (!thread || thread.deletedAt != null) return;
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if ((thread.title === 'New conversation' || !thread.title) && message.role === 'user') {
      // Provisional placeholder only — derived from what the user typed, with
      // the attachment footer stripped so it never leaks "[Attached: …]" text.
      // Auto-naming intentionally replaces this once the first turn completes.
      const body = splitAttachmentFooter(message.content).body;
      const title = body.replace(/\s+/g, ' ').trim().slice(0, 40);
      thread.title = title || 'New conversation';
    }
  }

  private appendChunk(threadId: string, messageId: string, chunk: string): void {
    const message = this.findMessage(threadId, messageId);
    if (message) message.content += chunk;
  }

  private queueTextChunk(threadId: string, messageId: string, chunk: string): void {
    this.textBuffer.enqueue(messageId, chunk, text => {
      if (!this.ownsStreamingTurn(threadId, messageId)) return;
      runInAction(() => this.appendChunk(threadId, messageId, text));
    });
  }

  clearLastError(): void {
    if (this.activeThreadId) this.setThreadLastError(this.activeThreadId, null);
  }

  dismissPersistenceConflict(): void {
    logger.warn('persistence', 'User dismissed multi-tab conflict; autosave resumed without reload');
    this.clearPersistenceConflict();
  }

  /** Reload chat state from localStorage after another tab wrote newer data. */
  reloadFromStorage(): void {
    const snapshot = loadSnapshot();
    runInAction(() => {
      // Stop any in-flight stream first: the thread list is about to be replaced
      // wholesale, and an abandoned turn would otherwise keep mutating (and
      // re-saving) state that no longer matches what's on disk.
      this.abortAllStreams();
      if (snapshot) {
        logger.info('persistence', 'Reloaded chat from localStorage after multi-tab conflict');
        this.applySnapshot(snapshot);
      } else {
        // The other tab cleared storage. Adopt that empty state instead of
        // keeping stale in-memory threads that would just re-save (and
        // resurrect data the user deleted in the other tab).
        logger.info('persistence', 'Storage cleared by another tab; resetting to an empty conversation');
        const thread = createEmptyThread();
        this.threads = [thread];
        this.activeThreadId = thread.id;
      }
      // Drop per-thread provider errors so a stale banner doesn't linger after
      // the thread list was replaced.
      this.lastErrorByThread = {};
    });
    this.clearPersistenceConflict();
  }

  private clearPersistenceConflict(): void {
    this.persistenceConflict = null;
    this.persistence.resume();
  }

  dismissCompactionNotice(): void {
    this.compactionNotice = null;
  }

  /** Per-thread provider errors for the composer banner (active thread only). */
  private setThreadLastError(threadId: string, message: string | null): void {
    if (!message) {
      delete this.lastErrorByThread[threadId];
    } else {
      const normalized = normalizeProviderErrorForBanner(message);
      if (this.lastErrorByThread[threadId] === normalized) return;
      this.lastErrorByThread[threadId] = normalized;
    }
  }

  private updateThread(threadId: string, updater: (thread: Thread) => Partial<Thread> | null | undefined): Thread | null {
    const idx = this.threads.findIndex(t => t.id === threadId);
    if (idx < 0) return null;
    const current = this.threads[idx];
    const patch = updater(current);
    if (!patch) return current;
    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.threads[idx] = next;
    this.schedulePersistSnapshot(this.snapshot);
    return next;
  }

  private touchMessage(threadId: string, messageId: string): void {
    const message = this.findMessage(threadId, messageId);
    if (message) message.createdAt = Date.now();
  }
}

function findPrecedingUserIndex(messages: Message[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}

function cloneMessagesForBranch(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.role === 'user') {
      return {
        id: newId('m'),
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
        ...(message.attachments ? { attachments: message.attachments.map(attachment => ({ ...attachment })) } : {}),
      };
    }
    return {
      id: newId('m'),
      role: 'assistant',
      content: message.content,
      createdAt: message.createdAt,
      ...(message.model ? { model: message.model } : {}),
      ...(message.workNotes ? { workNotes: [...message.workNotes] } : {}),
      ...(message.toolCalls ? { toolCalls: JSON.parse(JSON.stringify(message.toolCalls)) as AssistantMessage['toolCalls'] } : {}),
      ...(message.toolResults ? { toolResults: JSON.parse(JSON.stringify(message.toolResults)) as AssistantMessage['toolResults'] } : {}),
      ...(message.usage ? { usage: JSON.parse(JSON.stringify(message.usage)) as AssistantMessage['usage'] } : {}),
      ...(message.finishReason ? { finishReason: message.finishReason } : {}),
    };
  });
}

function branchTitle(title: string): string {
  const base = title.trim() || 'Untitled conversation';
  return base.endsWith(' (branch)') ? base : `${base} (branch)`;
}

function isImageGenerationAvailable(extras: ToolStoreContext | undefined): boolean {
  return Boolean(
    extras?.bridge?.isOnline
    && (
      extras?.imageGen?.getCredential('openrouter-image')
      || extras?.localRuntime?.comfyReady
    ),
  );
}

function hasAnyImageAttachment(messages: Message[]): boolean {
  for (const m of messages) {
    if (m.role !== 'user' || !m.attachments) continue;
    for (const a of m.attachments) {
      if (isImageMime(a.mime)) return true;
    }
  }
  return false;
}

function normalizeProviderErrorForBanner(message: string): string {
  return normalizeProviderErrorMessage(message);
}

export function normalizeOpenRouterThinkingEffort(effort: ThinkingEffort | undefined): ChatThinkingEffort {
  if (effort === 'medium' || effort === 'high') return effort;
  if (effort === 'xhigh') return 'high';
  return DEFAULT_OPENROUTER_THINKING_EFFORT;
}

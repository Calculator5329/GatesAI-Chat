import { autorun, makeAutoObservable, runInAction } from 'mobx';
import type { ActivityDetail, ActivityItem, AssistantMessage, ChatSnapshot, Message, Thread, ToolResult } from '../core/types';
import type { LlmProvider, LlmRequest, LlmUsage, ToolCall, ToolDef } from '../core/llm';
import { DEFAULT_MODEL_ID } from '../core/models';
import { formatAttachmentFooter, isImageMime, splitAttachmentFooter, toMessageAttachmentRef } from '../core/attachments';
import { flushPendingSnapshot, loadSnapshot, saveSnapshot, scheduleSaveSnapshot } from '../services/persistence';
import { computeUsage, contextWindowFor, estimateLlmPayloadTokens, estimateTokens, type TokenUsage } from '../core/tokens';
import { flattenForWire } from '../services/llm/wireFormat';
import { resolveWireImages } from '../services/llm/resolveImages';
import { modelSupportsVision } from '../core/modelCapabilities';
import {
  buildToolResultCompactionInput,
  compactLargeToolResultsInThread,
  deterministicCompactToolResult,
} from '../services/llm/contextCompaction';
import { StreamingTextBuffer } from '../services/streaming/StreamingTextBuffer';
import { toolRegistry, type ToolValidationResult } from '../services/tools/registry';
import { generateThreadTitle } from '../services/threadNamer';
import { buildRuntimeContext } from '../services/chat/runtimeContext';
import { isToolFailureContent, logToolCallFailure, safeJsonPreview } from '../services/chat/toolFailureLog';
import { logEvent } from '../services/diagnostics/chatLog';
import { createWorkspaceChatPersistence, type WorkspaceChatPersistence } from '../services/workspaceChatPersistence';
import type { ProviderStore } from './ProviderStore';
import type { ModelRegistry } from './ModelRegistry';
import type { UserProfileStore } from './UserProfileStore';
import type { ToolContext } from '../services/tools/types';
import type { BridgeClientFacade } from '../services/tools/types';
import type { ImageBackendId, LocalComfyMode } from '../services/image/types';
import type { CompletedJob } from '../services/image/jobs/types';

type ToolStoreContext = Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream' | 'imageGen' | 'imageJobs' | 'localRuntime' | 'search'>;
export type ChatContextMode = NonNullable<Thread['contextMode']>;

const MICRO_LOCAL_MAX_TOKENS = 512;
const MICRO_LOCAL_SYSTEM_PROMPT = [
  'Minimal local mode.',
  'Answer briefly. No persona.',
  'If a tool is available, call it with valid JSON. Do not print fake tool calls.',
  'Workspace paths use /workspace. Put deliverables under /workspace/artifacts/.',
  'After a successful write, stop calling tools and summarize the saved path.',
].join('\n');

const MICRO_FS_TOOL_DEF: ToolDef = {
  name: 'fs',
  description: 'Read/write/list/search files in /workspace. For edits call fs with JSON, e.g. {"action":"write","path":"/workspace/artifacts/reports/out.html","content":"..."}',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'write', 'append', 'list', 'stat', 'search', 'mkdir'] },
      path: { type: 'string' },
      content: { type: 'string' },
      encoding: { type: 'string', enum: ['utf8', 'utf-8', 'base64'] },
      query: { type: 'string' },
      recursive: { type: 'boolean' },
      max_chars: { type: 'number' },
      max_hits: { type: 'number' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  strict: true,
};

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
const TOOL_BATCH_WARN_THRESHOLD = 6;
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

function directImageComfyMode(providerModelId: string | undefined): LocalComfyMode {
  switch (providerModelId) {
    case 'comfy-direct-draft':
      return 'draft';
    case 'comfy-direct-upscale':
      return 'upscale';
    case 'comfy-direct':
    default:
      return 'normal';
  }
}

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
  lastError: string | null = null;

  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private readonly profile: UserProfileStore;
  private readonly controllersByThread = new Map<string, AbortController>();
  private readonly textBuffer = new StreamingTextBuffer();
  private workspacePersistence: WorkspaceChatPersistence | null = null;
  private workspacePersistenceReady = false;
  private workspacePersistenceHydrating = false;
  private pendingWorkspaceSnap: ChatSnapshot | null = null;
  private workspaceSaveInFlight = false;
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
    makeAutoObservable<this, 'providers' | 'registry' | 'profile' | 'controllersByThread' | 'textBuffer' | 'workspacePersistence' | 'workspacePersistenceReady' | 'workspacePersistenceHydrating' | 'pendingWorkspaceSnap' | 'workspaceSaveInFlight' | 'recentSummariesProvider' | 'toolStoresProvider'>(this, {
      providers: false,
      registry: false,
      profile: false,
      controllersByThread: false,
      textBuffer: false,
      workspacePersistence: false,
      workspacePersistenceReady: false,
      workspacePersistenceHydrating: false,
      pendingWorkspaceSnap: false,
      workspaceSaveInFlight: false,
      recentSummariesProvider: false,
      toolStoresProvider: false,
    });

    // Leading-edge + trailing-throttle the snapshot save: streaming fires
    // thousands of observable mutations per turn; an unthrottled autorun
    // would JSON.stringify every thread on each one. The first save runs
    // synchronously (so a fresh-thread create persists immediately and
    // tests can read it back without waiting), then subsequent updates
    // are coalesced to once per FLUSH_MS. Page teardown flushes any
    // pending save.
    const FLUSH_MS = 250;
    let lastSaveAt = 0;
    let pendingSnap: ChatSnapshot | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (pendingSnap) {
        this.schedulePersistSnapshot(pendingSnap);
        lastSaveAt = Date.now();
        pendingSnap = null;
      }
    };
    autorun(() => {
      const snap = this.snapshot;
      const now = Date.now();
      const elapsed = now - lastSaveAt;
      if (elapsed >= FLUSH_MS) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        pendingSnap = null;
        this.schedulePersistSnapshot(snap);
        lastSaveAt = now;
        return;
      }
      pendingSnap = snap;
      if (pendingTimer) return;
      pendingTimer = setTimeout(flush, FLUSH_MS - elapsed);
    });
    if (typeof window !== 'undefined') {
      // Unload paths must persist synchronously — drain the throttle queue
      // and flush any microtask-deferred write before the page tears down.
      const syncFlush = (): void => {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        if (pendingSnap) {
          saveSnapshot(pendingSnap);
          this.scheduleWorkspaceSnapshotSave(pendingSnap);
          lastSaveAt = Date.now();
          pendingSnap = null;
        }
        flushPendingSnapshot();
      };
      window.addEventListener('pagehide', syncFlush);
      window.addEventListener('beforeunload', syncFlush);
    }
  }

  get snapshot(): ChatSnapshot {
    return { threads: this.threads, activeThreadId: this.activeThreadId };
  }

  get activeThread(): Thread | null {
    return this.threads.find(t => t.id === this.activeThreadId) ?? null;
  }

  async enableWorkspacePersistence(client: BridgeClientFacade): Promise<boolean> {
    if (this.workspacePersistenceHydrating) return false;
    this.workspacePersistenceHydrating = true;
    const persistence = createWorkspaceChatPersistence(client);
    try {
      const loaded = await persistence.load();
      if (loaded.kind === 'loaded') {
        runInAction(() => {
          this.applySnapshot(loaded.snapshot);
        });
        saveSnapshot(this.snapshot);
      } else if (loaded.kind === 'malformed') {
        try {
          await persistence.backupMalformed(loaded.raw);
        } catch (err) {
          console.warn('[persistence] failed to back up malformed workspace chat snapshot', err);
        }
        await persistence.save(this.snapshot, 'localStorage-migration');
      } else {
        await persistence.save(this.snapshot, 'localStorage-migration');
      }
      this.workspacePersistence = persistence;
      this.workspacePersistenceReady = true;
      this.scheduleWorkspaceSnapshotSave(this.snapshot);
      return true;
    } catch (err) {
      console.warn('[persistence] workspace chat persistence unavailable', err);
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
    const idx = this.threads.findIndex(t => t.id === threadId);
    if (idx < 0) return;
    const thread = this.threads[idx];
    this.threads[idx] = { ...thread, modelId };
  }

  setThreadContextMode(threadId: string, mode: ChatContextMode): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    thread.contextMode = mode;
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
    const extras = this.toolStoresProvider?.();
    const results = message.toolResults ?? [];
    const ownerThreadId = this.threadIdForMessage(message.id);
    const items: ActivityItem[] = [];

    const usedResultIndexes = new Set<number>();
    for (const call of message.toolCalls ?? []) {
      const resultIndex = results.findIndex((candidate, index) => !usedResultIndexes.has(index) && candidate.toolCallId === call.id);
      if (resultIndex >= 0) usedResultIndexes.add(resultIndex);
      const result = resultIndex >= 0 ? results[resultIndex] : undefined;
      const tool = toolRegistry.get(call.name);
      const artifacts = result?.artifacts;
      const imageJob = artifacts?.find(artifact => artifact.kind === 'image-job');
      const state = result
        ? stateForToolResult(result, imageJob ? extras?.imageJobs?.findById?.(imageJob.jobId)?.status : undefined)
        : 'running';
      const summary = result
        ? (tool?.ui?.summary?.({
            content: result.content,
            summary: result.summary,
            ok: result.ok,
            errorCode: result.errorCode,
            retryable: result.retryable,
            artifacts: result.artifacts,
          }) ?? result.summary)
        : undefined;
      const runningExec = !result && call.name === 'terminal' ? runningExecForCall(extras?.execStream?.jobs, ownerThreadId, call.id) : null;
      items.push({
        id: call.id,
        kind: imageJob ? 'image-job' : 'tool',
        state,
        verb: tool?.ui?.verb(call.arguments) ?? 'Using',
        target: tool?.ui?.target?.(call.arguments),
        summary,
        detail: runningExec
          ? {
              type: 'terminal',
              lines: runningExec.tail,
              placeholder: runningExec.tail.length ? undefined : '(no output yet)',
            }
          : result?.content
            ? detailForToolResult(call.name, result.content)
            : undefined,
        artifacts,
        startedAt: message.createdAt,
        finishedAt: result?.ranAt,
        toolCallId: call.id,
      });
    }

    for (const event of message.activityEvents ?? []) items.push(event);

    if (options.streaming && message.content.trim().length === 0) {
      const label = message.preTokenLabel ?? 'thinking';
      items.push({
        id: `${message.id}:pretoken`,
        kind: 'thinking',
        state: 'running',
        verb: label[0].toUpperCase() + label.slice(1),
        startedAt: message.createdAt,
      });
    }

    return items;
  }

  recordActivityEvent(event: ActivityItem): void {
    const threadId = this.activeThreadId;
    if (!threadId) return;
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
    const thread = this.findThread(job.threadId);
    if (!thread) return;
    const terminalKey = imageTerminalKey(job);
    const alreadyNotified = thread.messages.some(message =>
      message.role === 'assistant'
      && message.toolCalls?.some(call =>
        call.name === 'image_generate_complete'
        && call.arguments.jobId === job.id
        && call.arguments.terminalKey === terminalKey
      )
    );
    if (alreadyNotified) return;

    const backend = imageBackendDisplayName(job.backend);
    const elapsed = formatImageElapsed(job);
    const message: AssistantMessage = {
      id: newId('m'),
      role: 'assistant',
      content: imageTerminalMessage(job, backend, elapsed),
      createdAt: Date.now(),
      model: thread.modelId,
    };

    const callId = newId('tc');
    message.toolCalls = [{
      id: callId,
      name: 'image_generate_complete',
      arguments: { jobId: job.id, status: job.status, terminalKey },
    }];
    message.toolResults = [{
      toolCallId: callId,
      toolName: 'image_generate_complete',
      content: imageTerminalToolResult(job, backend, elapsed),
      summary: `Image job ${job.status}.`,
      ranAt: Date.now(),
    }];

    runInAction(() => {
      this.appendMessage(job.threadId, message);
    });
  }

  /**
   * Per-thread context appended to the system prompt under "About this
   * conversation:". Persists with the thread snapshot. No editor UI yet.
   */
  setThreadContext(threadId: string, context: string): void {
    const idx = this.threads.findIndex(t => t.id === threadId);
    if (idx < 0) return;
    this.threads[idx] = { ...this.threads[idx], threadContext: context };
    this.schedulePersistSnapshot(this.snapshot);
  }

  /**
   * Rename a thread. Used by the `thread` tool and any future inline-rename
   * UI. No-op if the id is unknown.
   */
  renameThread(threadId: string, title: string): void {
    const idx = this.threads.findIndex(t => t.id === threadId);
    if (idx < 0) return;
    const next = title.trim();
    this.threads[idx] = { ...this.threads[idx], title: next || 'Untitled conversation' };
    this.schedulePersistSnapshot(this.snapshot);
  }

  clearAllThreads(): void {
    for (const controller of this.controllersByThread.values()) controller.abort();
    this.controllersByThread.clear();
    this.textBuffer.cancelAll();
    this.streamingByThread = {};
    const thread = createEmptyThread();
    this.threads = [thread];
    this.activeThreadId = thread.id;
    this.lastError = null;
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
    const controller = this.controllersByThread.get(threadId);
    if (controller) {
      controller.abort();
      this.controllersByThread.delete(threadId);
    }
    this.textBuffer.cancel(threadId);
    delete this.streamingByThread[threadId];
    thread.deletedAt = Date.now();
    if (this.activeThreadId === threadId) {
      const next = this.visibleThreads[0];
      this.activeThreadId = next ? next.id : this.createThread();
    }
  }

  /** Restore a soft-deleted thread. No-op if it isn't deleted. */
  restoreThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt == null) return;
    thread.deletedAt = undefined;
  }

  toggleThreadPinned(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return;
    thread.pinned = !thread.pinned;
    thread.updatedAt = Date.now();
  }

  branchThreadFromMessage(threadId: string, messageId: string): string | null {
    const source = this.findThread(threadId);
    if (!source || source.deletedAt != null) return null;
    if (this.isThreadStreaming(source.id)) return null;
    const index = source.messages.findIndex(message => message.id === messageId);
    if (index < 0) return null;
    return this.createBranchThread(source, index);
  }

  regenerateFromMessage(threadId: string, messageId: string): string | null {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return null;
    const index = thread.messages.findIndex(message => message.id === messageId);
    const message = thread.messages[index];
    if (!message || message.role !== 'assistant') return null;
    const precedingUserIndex = findPrecedingUserIndex(thread.messages, index);
    if (precedingUserIndex < 0) return null;

    const isLatestAssistant = index === thread.messages.length - 1;
    if (this.isThreadStreaming(thread.id) && !isLatestAssistant) return null;
    if (isLatestAssistant) {
      if (this.isThreadStreaming(thread.id)) this.interruptThread(thread.id);
      thread.messages.splice(index, 1);
      thread.updatedAt = Date.now();
      this.startTurn(thread.id, true);
      return thread.id;
    }

    const branchId = this.createBranchThread(thread, precedingUserIndex);
    if (!branchId) return null;
    this.startTurn(branchId, true);
    return branchId;
  }

  editAndResendFromMessage(threadId: string, messageId: string, text: string): string | null {
    const source = this.findThread(threadId);
    if (!source || source.deletedAt != null) return null;
    if (this.isThreadStreaming(source.id)) return null;
    const index = source.messages.findIndex(message => message.id === messageId);
    const original = source.messages[index];
    const trimmed = text.trim();
    if (!original || original.role !== 'user' || !trimmed) return null;

    const branchId = this.createBranchThread(source, index - 1);
    if (!branchId) return null;
    const branch = this.findThread(branchId);
    if (!branch) return null;
    const userMessage: Message = {
      id: newId('m'),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      ...(original.attachments ? { attachments: original.attachments.map(attachment => ({ ...attachment })) } : {}),
    };
    this.appendMessage(branch.id, userMessage);
    this.startTurn(branch.id, true);
    return branch.id;
  }

  /**
   * Send a user message on the active thread, then begin the model→tool loop.
   *
   * If a reply is already streaming on this thread, it's interrupted first:
   * the partial assistant message is annotated `*[interrupted]*` (so future
   * turns don't see a half-thought as if it were complete) and a fresh
   * stream is started for the new turn. Other threads' streams are untouched.
   */
  sendMessage(text: string, attachments: { filename: string; path: string; size: number; mime: string }[] = []): void {
    const thread = this.ensureThreadModel(this.activeThreadId);
    const trimmed = text.trim();
    if (!thread || (!trimmed && attachments.length === 0)) return;

    const isReplacingInterruptedReply = this.isThreadStreaming(thread.id);
    if (this.isThreadStreaming(thread.id)) {
      this.interruptThread(thread.id);
    }

    this.lastError = null;

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
        this.lastError = (err as Error).message;
        this.clearStreamingState(targetThreadId);
      }));
  }

  private startTurn(threadId: string, isReplacingInterruptedReply = false): void {
    const thread = this.ensureThreadModel(threadId);
    if (!thread || thread.messages.length === 0) return;
    if (this.isThreadStreaming(thread.id)) this.interruptThread(thread.id);
    this.activeThreadId = thread.id;
    this.lastError = null;
    const controller = new AbortController();
    this.controllersByThread.set(thread.id, controller);
    this.runTurn(thread.id, controller.signal, isReplacingInterruptedReply)
      .catch(err => runInAction(() => {
        this.lastError = (err as Error).message;
        this.clearStreamingState(thread.id);
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

  private clearStreamingState(threadId: string): void {
    delete this.streamingByThread[threadId];
    this.controllersByThread.delete(threadId);
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

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) return;

      let provider: LlmProvider;
      let providerModelId: string;
      try {
        ({ provider, providerModelId } = this.providers.router.resolve(thread.modelId));
      } catch (err) {
        const msg = (err as Error).message;
        logEvent(thread.id, 'round.resolveError', { round, modelId: thread.modelId, error: msg });
        this.textBuffer.flush(assistantMessage.id);
        runInAction(() => {
          this.lastError = msg;
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            m.content = `_Error: ${msg}_`;
            this.touchMessage(threadId, assistantMessage.id);
          }
          this.clearStreamingState(threadId);
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
          runInAction(() => this.clearStreamingState(threadId));
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
          this.lastError = message;
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            m.content = message;
            this.touchMessage(threadId, assistantMessage.id);
          }
          this.clearStreamingState(threadId);
        });
        return;
      }

      const collectedCalls: ToolCall[] = [];
      const collectedUsage: LlmUsage[] = [];
      let errored = false;
      let errorMessage: string | undefined;
      try {
        for await (const chunk of provider.stream(request, signal)) {
          if (chunk.type === 'text') {
            this.queueTextChunk(threadId, assistantMessage.id, chunk.delta);
          } else if (chunk.type === 'tool_call') {
            collectedCalls.push(chunk.call);
          } else if (chunk.type === 'usage') {
            collectedUsage.push(chunk.usage);
          } else if (chunk.type === 'done') {
            logEvent(thread.id, 'round.done', { round, finishReason: chunk.finishReason, error: chunk.error });
            if (chunk.finishReason === 'error' && chunk.error) {
              errored = true;
              errorMessage = chunk.error;
            }
            break;
          }
        }
      } catch (err) {
        if (signal.aborted) {
          this.textBuffer.flush(assistantMessage.id);
          runInAction(() => this.clearStreamingState(threadId));
          return;
        }
        logEvent(thread.id, 'round.exception', { round, error: (err as Error).message, stack: (err as Error).stack });
        errored = true;
        errorMessage = (err as Error).message;
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
        runInAction(() => {
          this.lastError = errorMessage ?? 'unknown error';
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            const recovery = formatProviderErrorRecovery(m, errorMessage ?? 'unknown error');
            m.content = m.content.trim()
              ? `${m.content.trimEnd()}\n\n${recovery}`
              : recovery;
            this.touchMessage(threadId, assistantMessage.id);
          }
        });
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
                this.clearStreamingState(threadId);
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
          const results = await this.executeToolCalls(rescuedCalls, threadId, signal);
          if (signal.aborted) {
            runInAction(() => this.clearStreamingState(threadId));
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

      if (errored || collectedCalls.length === 0) {
        this.textBuffer.flush(assistantMessage.id);
        // Final round (no calls) or terminal error — keep whatever prose
        // was streamed and stop.
        runInAction(() => {
          this.touchMessage(threadId, assistantMessage.id);
          this.clearStreamingState(threadId);
        });
        this.maybeAutoName(threadId, assistantMessage);
        return;
      }

      const currentForTools = this.findMessage(threadId, assistantMessage.id);
      const toolMessage = currentForTools && currentForTools.role === 'assistant' ? currentForTools : assistantMessage;
      const uniqueCollectedCalls = uniqueToolCallIds(collectedCalls, toolMessage, round);
      const repeat = repeatedSideEffectLoop(uniqueCollectedCalls, toolMessage);
      if (repeat) {
        this.textBuffer.flush(assistantMessage.id);
        runInAction(() => {
          const m = this.findMessage(threadId, assistantMessage.id);
          if (m && m.role === 'assistant') {
            const note = normalizeWorkNote(m.content);
            if (note) m.workNotes = appendWorkNote(m.workNotes, note);
            m.content = formatRepeatedSideEffectLoopMessage(repeat);
            this.touchMessage(threadId, assistantMessage.id);
          }
          this.clearStreamingState(threadId);
        });
        this.maybeAutoName(threadId, assistantMessage);
        return;
      }

      // Mid-turn: the model called tools. Keep any streamed pre-tool prose as
      // visible work notes, then clear `content` so the next streamed text is
      // the model's closing reply after tool results are available.
      this.textBuffer.flush(assistantMessage.id);
      if (signal.aborted) {
        runInAction(() => this.clearStreamingState(threadId));
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

      const results = await this.executeToolCalls(uniqueCollectedCalls, threadId, signal);
      if (signal.aborted) {
        runInAction(() => this.clearStreamingState(threadId));
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
      this.lastError = message;
      if (current && current.role === 'assistant') {
        current.content = message;
        this.touchMessage(threadId, assistantMessage.id);
      }
      this.clearStreamingState(threadId);
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
    return {
      modelId: providerModelId,
      messages: wireMessagesForContextMode(thread, mode),
      ...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
      ...(tools ? { tools } : {}),
      ...(reservedOutputTokensForContextMode(mode) != null ? { maxTokens: reservedOutputTokensForContextMode(mode) } : {}),
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
   * Skipped if: thread already auto-named, the user has manually typed
   * a non-default title (heuristic: title ≠ first 40 chars of opener),
   * or there's no opening user message.
   */
  private maybeAutoName(threadId: string, assistantMessage: AssistantMessage): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.autoNamed) return;
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
      if (title) {
        thread.title = title;
        thread.autoNamed = true;
      }
    })).catch(() => runInAction(() => { thread.naming = false; }));
  }

  private async executeToolCalls(calls: ToolCall[], threadId: string, signal: AbortSignal): Promise<ToolResult[]> {
    const results = new Array<ToolResult>(calls.length);
    const invalidSeen = new Set<string>();
    const batchStartedAt = Date.now();
    const largeBatchWarning = calls.length > TOOL_BATCH_WARN_THRESHOLD
      ? `status: warning\ntool: tool_batch_policy\nsummary: Large tool batch detected (${calls.length} calls). Prefer ${TOOL_BATCH_WARN_THRESHOLD} or fewer independent calls; dependent file-generation work should be sequential.`
      : null;
    if (largeBatchWarning) {
      logEvent(threadId, 'tool.batch.warning', {
        count: calls.length,
        threshold: TOOL_BATCH_WARN_THRESHOLD,
        toolNames: calls.map(call => call.name),
      });
    }
    const validations = calls.map((call, index) => {
      const validation = toolRegistry.validateToolCall(call);
      this.logToolValidation(threadId, call, validation, index);
      return validation;
    });
    const invalids = validations
      .map((validation, index) => ({ validation, index, call: calls[index] }))
      .filter(item => !item.validation.ok);
    if (invalids.length > 0) {
      const firstInvalidIndex = invalids[0].index;
      const batchSummary = formatInterruptedToolBatchSummary(invalids, firstInvalidIndex);
      logEvent(threadId, 'tool.batch.interrupted', {
        count: calls.length,
        invalid: invalids.length,
        executedPrefix: firstInvalidIndex,
        invalidIndexes: invalids.map(item => item.index),
        errorCodes: invalids.map(item => item.validation.errorCode),
      });
      if (firstInvalidIndex > 0) {
        const prefixResults = await this.executeValidatedToolCalls(calls.slice(0, firstInvalidIndex), threadId, signal);
        prefixResults.forEach((result, index) => { results[index] = result; });
      }
      const invalidByIndex = new Map(invalids.map(item => [item.index, item]));
      if (!signal.aborted) {
        for (let index = firstInvalidIndex; index < calls.length; index += 1) {
          const invalid = invalidByIndex.get(index);
          results[index] = invalid
            ? this.invalidToolCallResult(calls[index], invalid.validation, invalidSeen, threadId, {
                callIndex: index,
                batchSummary,
              })
            : this.skippedAfterInvalidToolCallResult(calls[index], index, batchSummary, firstInvalidIndex);
        }
      }
      const finished = results.filter(Boolean);
      if (largeBatchWarning && finished[0]) {
        finished[0] = {
          ...finished[0],
          content: `${largeBatchWarning}\n\n${finished[0].content}`,
          outputChars: `${largeBatchWarning}\n\n${finished[0].content}`.length,
        };
      }
      logEvent(threadId, 'tool.batch.finished', {
        count: calls.length,
        results: finished.length,
        invalid: invalids.length,
        skipped: Math.max(0, calls.length - firstInvalidIndex - invalids.length),
        durationMs: Date.now() - batchStartedAt,
        largeBatch: Boolean(largeBatchWarning),
        interrupted: true,
        executedPrefix: firstInvalidIndex,
      });
      return finished;
    }
    const finished = await this.executeValidatedToolCalls(calls, threadId, signal);
    if (largeBatchWarning && finished[0]) {
      finished[0] = {
        ...finished[0],
        content: `${largeBatchWarning}\n\n${finished[0].content}`,
        outputChars: `${largeBatchWarning}\n\n${finished[0].content}`.length,
      };
    }
    logEvent(threadId, 'tool.batch.finished', {
      count: calls.length,
      results: finished.length,
      invalid: finished.filter(result => result.ok === false).length,
      durationMs: Date.now() - batchStartedAt,
      largeBatch: Boolean(largeBatchWarning),
    });
    return finished;
  }

  private async executeValidatedToolCalls(calls: ToolCall[], threadId: string, signal: AbortSignal): Promise<ToolResult[]> {
    const results = new Array<ToolResult>(calls.length);
    let index = 0;
    while (index < calls.length) {
      if (signal.aborted) break;
      const call = calls[index];
      if (toolRegistry.isReadOnlyCall(call.name, call.arguments)) {
        const groupStart = index;
        const group: ToolCall[] = [];
        while (
          index < calls.length
          && toolRegistry.isReadOnlyCall(calls[index].name, calls[index].arguments)
        ) {
          group.push(calls[index]);
          index += 1;
        }
        const groupResults = await Promise.all(group.map(call => this.executeOneToolCall(call, threadId, signal)));
        if (signal.aborted) break;
        groupResults.forEach((result, offset) => { results[groupStart + offset] = result; });
      } else {
        const result = await this.executeOneToolCall(call, threadId, signal);
        if (signal.aborted) break;
        results[index] = result;
        index += 1;
      }
    }
    return results.filter(Boolean);
  }

  private logToolValidation(threadId: string, call: ToolCall, validation: ToolValidationResult, index?: number): void {
    logEvent(threadId, 'tool.call.validated', {
      toolName: call.name,
      toolCallId: call.id,
      ...(index != null ? { index } : {}),
      ok: validation.ok,
      errorCode: validation.errorCode,
      retryable: validation.retryable,
      argumentsPreview: safeJsonPreview(call.arguments),
      hasArgumentParseError: Boolean(call.argumentsError),
    });
  }

  private invalidToolCallResult(
    call: ToolCall,
    validation: ToolValidationResult,
    invalidSeen: Set<string>,
    threadId: string,
    batch?: { callIndex: number; batchSummary: string },
  ): ToolResult {
    const validationError = validation.content ?? `status: error\ntool: ${call.name}\nsummary: invalid tool call`;
    const key = `${call.name}:${validationError}:${safeStableJson(call.arguments)}`;
    const repeated = invalidSeen.has(key);
    invalidSeen.add(key);
    const startedAt = Date.now();
    if (!repeated) {
      const extras = this.toolStoresProvider?.() ?? ({} as ToolStoreContext);
      logToolCallFailure({
        call,
        threadId,
        content: validationError,
        startedAt: Date.now(),
        bridgeOnline: extras.bridge?.isOnline,
        readOnly: false,
      });
      logEvent(threadId, 'tool.call.failed', {
        toolName: call.name,
        toolCallId: call.id,
        phase: 'validation',
        errorCode: validation.errorCode,
        retryable: validation.retryable,
        durationMs: 0,
        outputChars: validationError.length,
      });
    }
    const content = repeated
      ? `status: error\ntool: ${call.name}\nerror_code: repeated_invalid_tool_call\nsummary: Skipped repeated invalid tool call.\nfix: Correct the prior validation error before retrying.\nretryable: true\nprevious_error: ${validation.summary ?? validationError.replace(/\s+/g, ' ').slice(0, 300)}`
      : [
          ...(batch ? [batch.batchSummary, `call_index: ${batch.callIndex}`] : []),
          validationError,
        ].join('\n');
    return {
      toolCallId: call.id,
      toolName: call.name,
      content,
      summary: repeated ? 'Skipped repeated invalid tool call.' : validation.summary,
      ok: false,
      errorCode: repeated ? 'repeated_invalid_tool_call' : validation.errorCode,
      retryable: repeated ? true : validation.retryable,
      durationMs: Date.now() - startedAt,
      outputChars: content.length,
      ranAt: Date.now(),
    };
  }

  private skippedAfterInvalidToolCallResult(call: ToolCall, callIndex: number, batchSummary: string, firstInvalidIndex: number): ToolResult {
    const content = [
      batchSummary,
      `call_index: ${callIndex}`,
      `first_invalid_call_index: ${firstInvalidIndex}`,
      `status: error`,
      `tool: ${call.name}`,
      `error_code: skipped_after_invalid_tool_call`,
      `summary: This valid-looking tool call was not executed because an earlier call in the same batch failed validation.`,
      `fix: Retry this call only after correcting the earlier invalid call. Keep dependent side-effect work in separate sequential batches.`,
      `retryable: true`,
    ].join('\n');
    return {
      toolCallId: call.id,
      toolName: call.name,
      content,
      summary: 'This valid-looking tool call was not executed because an earlier call in the same batch failed validation.',
      ok: false,
      errorCode: 'skipped_after_invalid_tool_call',
      retryable: true,
      durationMs: 0,
      outputChars: content.length,
      ranAt: Date.now(),
    };
  }

  private async executeOneToolCall(call: ToolCall, threadId: string, signal: AbortSignal): Promise<ToolResult> {
    const extras = this.toolStoresProvider?.() ?? ({} as ToolStoreContext);
    const startedAt = Date.now();
    if (signal.aborted) {
      const content = 'Cancelled.';
      return {
        toolCallId: call.id,
        toolName: call.name,
        content,
        summary: 'Cancelled.',
        ok: false,
        errorCode: 'cancelled',
        retryable: true,
        durationMs: 0,
        outputChars: content.length,
        ranAt: Date.now(),
      };
    }
    logEvent(threadId, 'tool.call.started', {
      toolName: call.name,
      toolCallId: call.id,
      readOnly: toolRegistry.isReadOnlyCall(call.name, call.arguments),
      argumentsPreview: safeJsonPreview(call.arguments),
      bridgeOnline: extras.bridge?.isOnline,
    });
    const { content, summary, artifacts, ok, errorCode, retryable } = await toolRegistry.execute(call.name, call.arguments, {
      profile: this.profile,
      chat: this,
      notes: extras.notes,
      summary: extras.summary,
      bridge: extras.bridge,
      execStream: extras.execStream,
      imageGen: extras.imageGen,
      imageJobs: extras.imageJobs,
      localRuntime: extras.localRuntime,
      search: extras.search,
      threadId,
      toolCallId: call.id,
      signal,
    });
    const durationMs = Date.now() - startedAt;
    const failed = ok === false || isToolFailureContent(call.name, content);
    if (failed) {
      logToolCallFailure({
        call,
        threadId,
        content,
        startedAt,
        bridgeOnline: extras.bridge?.isOnline,
        readOnly: toolRegistry.isReadOnlyCall(call.name, call.arguments),
      });
      logEvent(threadId, 'tool.call.failed', {
        toolName: call.name,
        toolCallId: call.id,
        phase: 'execution',
        errorCode: errorCode ?? 'tool_error',
        retryable,
        durationMs,
        outputChars: content.length,
        bridgeOnline: extras.bridge?.isOnline,
      });
    } else {
      logEvent(threadId, 'tool.call.finished', {
        toolName: call.name,
        toolCallId: call.id,
        durationMs,
        outputChars: content.length,
        bridgeOnline: extras.bridge?.isOnline,
      });
    }
    return {
      toolCallId: call.id,
      toolName: call.name,
      content,
      ...(summary ? { summary } : {}),
      ok: !failed,
      ...(failed && errorCode ? { errorCode } : {}),
      ...(failed && retryable != null ? { retryable } : {}),
      durationMs,
      outputChars: content.length,
      ranAt: Date.now(),
      ...(artifacts && artifacts.length ? { artifacts } : {}),
    };
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
    const prompt = latestUserPromptBody(thread).trim();

    runInAction(() => {
      const message = this.findMessage(thread.id, assistantMessage.id);
      if (!message || message.role !== 'assistant') {
        this.clearStreamingState(thread.id);
        return;
      }
      if (!prompt) {
        message.content = '_Direct image mode: no prompt found in your last message._';
        this.touchMessage(thread.id, message.id);
        this.clearStreamingState(thread.id);
        return;
      }
      if (!imageJobs || !imageGen) {
        message.content = '_Direct image mode: image-jobs subsystem not wired in this session._';
        this.touchMessage(thread.id, message.id);
        this.clearStreamingState(thread.id);
        return;
      }

      const snapshot = imageGen.toBackendConfig();
      const activeModel = this.registry.findById(thread.modelId);
      const comfyMode = snapshot.primary === 'local-comfy'
        ? directImageComfyMode(activeModel?.providerModelId)
        : undefined;
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
        backend: snapshot.primary,
        comfyMode,
        filenamePrefix: slug,
      });

      // Attach the image-job artifact via a synthetic tool-call/result
      // pair so EditorialMessage's existing artifact pipeline picks it up.
      const callId = newId('tc');
      const backendLabel = imageBackendDisplayName(snapshot.primary);
      const estimate = estimatedImageDuration(snapshot.primary);
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
      this.clearStreamingState(thread.id);
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
    scheduleSaveSnapshot(snapshot);
    this.scheduleWorkspaceSnapshotSave(snapshot);
  }

  private scheduleWorkspaceSnapshotSave(snapshot: ChatSnapshot): void {
    if (!this.workspacePersistenceReady || !this.workspacePersistence) return;
    this.pendingWorkspaceSnap = snapshot;
    if (this.workspaceSaveInFlight) return;
    this.drainWorkspaceSnapshotSave();
  }

  private drainWorkspaceSnapshotSave(): void {
    if (!this.workspacePersistence || !this.pendingWorkspaceSnap) return;
    const snap = this.pendingWorkspaceSnap;
    this.pendingWorkspaceSnap = null;
    this.workspaceSaveInFlight = true;
    void this.workspacePersistence.save(snap)
      .catch(err => {
        console.warn('[persistence] failed to save workspace chat snapshot', err);
      })
      .finally(() => {
        this.workspaceSaveInFlight = false;
        if (this.pendingWorkspaceSnap) this.drainWorkspaceSnapshotSave();
      });
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
    const messages = through >= 0 ? cloneMessages(source.messages.slice(0, through + 1)) : [];
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
      ...(source.threadContext ? { threadContext: source.threadContext } : {}),
    };
    this.threads.unshift(branch);
    this.activeThreadId = branch.id;
    return branch.id;
  }

  private appendMessage(threadId: string, message: Message): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if ((thread.title === 'New conversation' || !thread.title) && message.role === 'user') {
      const title = message.content.replace(/\s+/g, ' ').slice(0, 40);
      thread.title = title || 'New conversation';
    }
  }

  private appendChunk(threadId: string, messageId: string, chunk: string): void {
    const message = this.findMessage(threadId, messageId);
    if (message) message.content += chunk;
  }

  private queueTextChunk(threadId: string, messageId: string, chunk: string): void {
    this.textBuffer.enqueue(messageId, chunk, text => {
      runInAction(() => this.appendChunk(threadId, messageId, text));
    });
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

function cloneMessages(messages: Message[]): Message[] {
  return messages.map(message => JSON.parse(JSON.stringify(message)) as Message);
}

function branchTitle(title: string): string {
  const base = title.trim() || 'Untitled conversation';
  return base.endsWith(' (branch)') ? base : `${base} (branch)`;
}

export function threadLlmSpendUsd(thread: Thread | null): number {
  if (!thread) return 0;
  return thread.messages.reduce((sum, message) => {
    if (message.role !== 'assistant') return sum;
    return sum + (message.usage ?? []).reduce((inner, usage) => (
      usage.providerId === 'openrouter' && typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)
        ? inner + usage.costUsd
        : inner
    ), 0);
  }, 0);
}

function stateForToolResult(result: ToolResult, artifactStatus?: string): ActivityItem['state'] {
  if (artifactStatus === 'cancelled') return 'cancelled';
  if (artifactStatus === 'failed') return 'failed';
  if (artifactStatus === 'pending' || artifactStatus === 'running') return 'running';
  if (result.errorCode === 'cancelled') return 'cancelled';
  if (result.ok === false || result.errorCode || isToolFailureContent(result.toolName, result.content)) return 'failed';
  return 'done';
}

function detailForToolResult(toolName: string, content: string): ActivityDetail {
  if (toolName === 'terminal' || toolName === 'git' || toolName === 'python_inline' || toolName === 'sqlite_query' || toolName === 'query_script') {
    return {
      type: 'terminal',
      lines: content.split(/\r?\n/).map(text => ({ stream: 'stdout', text })),
    };
  }
  return { type: 'markdown', content };
}

function runningExecForCall(jobs: NonNullable<ToolStoreContext['execStream']>['jobs'] | undefined, threadId: string | undefined, toolCallId: string) {
  if (!jobs) return null;
  const running = Object.values(jobs).filter(job =>
    job.status === 'running'
    && job.toolCallId === toolCallId
    && (!threadId || !job.threadId || job.threadId === threadId)
  );
  if (running.length === 0) return null;
  return running.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
}

const IMAGE_GEN_ADDENDUM = 'When you call image_generate, treat the tool result as queued, not successful. Tell the user the render is queued, name the backend if useful, and set expectation that it may take roughly a minute. Do not say the image was generated, completed, or successful just because the tool returned. The inline image-job card is the source of truth for pending, success, failure, cancellation, and failure reason; the app will post a completion follow-up when the job finishes.';

function appendImageGenAddendum(systemPrompt: string | undefined, tools: { name: string }[] | undefined): string | undefined {
  if (!tools || !tools.some(t => t.name === 'image_generate')) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${IMAGE_GEN_ADDENDUM}` : IMAGE_GEN_ADDENDUM;
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

function imageBackendDisplayName(backend: ImageBackendId): string {
  return backend === 'openrouter-image'
    ? 'OpenRouter GPT-5.4 Image 2'
    : 'local ComfyUI';
}

function estimatedImageDuration(backend: ImageBackendId): string {
  return backend === 'openrouter-image'
    ? 'about 30-90 seconds'
    : 'about 10-60 seconds';
}

function formatImageElapsed(job: CompletedJob): string {
  if (!job.startedAt || !job.completedAt || job.completedAt <= job.startedAt) return '';
  const seconds = Math.max(1, Math.round((job.completedAt - job.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function imageTerminalMessage(job: CompletedJob, backend: string, elapsed: string): string {
  const elapsedPart = elapsed ? ` in ${elapsed}` : '';
  if (job.status === 'done') {
    const count = job.results.length;
    const noun = count === 1 ? 'image is' : `${count} images are`;
    return `Here ${count === 1 ? 'it is' : 'they are'} — your ${noun} ready from ${backend}${elapsedPart}.`;
  }
  if (job.status === 'cancelled') {
    return `The image render through ${backend} was cancelled${elapsedPart}.`;
  }
  const detail = job.error ? ` ${job.error}` : '';
  return `The image render through ${backend} failed${elapsedPart}.${detail}`;
}

function imageTerminalToolResult(job: CompletedJob, backend: string, elapsed: string): string {
  if (job.status === 'done') {
    return `Image render completed through ${backend}${elapsed ? ` in ${elapsed}` : ''}.`;
  }
  if (job.status === 'cancelled') {
    return `Image render cancelled through ${backend}${elapsed ? ` after ${elapsed}` : ''}.`;
  }
  return `Image render failed through ${backend}${elapsed ? ` after ${elapsed}` : ''}: ${job.error ?? 'Unknown error'}`;
}

function imageTerminalKey(job: CompletedJob): string {
  return `${job.id}:${job.status}:${job.completedAt ?? 0}:${job.results.length}:${job.error ?? ''}`;
}

function latestUserMessageContent(thread: Thread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return message.content;
  }
  return '';
}

function latestUserMessage(thread: Thread): Message | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return message;
  }
  return null;
}

function latestUserPromptBody(thread: Thread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return splitAttachmentFooter(message.content).body;
  }
  return '';
}

function effectiveContextMode(thread: Thread, model: { providerId: string } | undefined): ChatContextMode {
  if (model?.providerId !== 'ollama') return 'full';
  return thread.contextMode ?? 'micro';
}

function systemPromptForContextMode(mode: ChatContextMode, normalPrompt: () => string | undefined): string | undefined {
  if (mode === 'bare') return undefined;
  if (mode === 'micro') return MICRO_LOCAL_SYSTEM_PROMPT;
  return normalPrompt();
}

function wireMessagesForContextMode(thread: Thread, mode: ChatContextMode) {
  if (mode === 'full') return flattenForWire(thread.messages);
  const latest = latestUserMessage(thread);
  return latest ? flattenForWire([latest]) : [];
}

function toolsForContextMode(args: {
  mode: ChatContextMode;
  toolsAllowed: boolean;
  userText: string;
  bridgeOnline: boolean;
  imageGenAvailable?: boolean;
  webSearchAvailable?: boolean;
}): ToolDef[] | undefined {
  if (!args.toolsAllowed || args.mode === 'bare') return undefined;
  if (args.mode === 'micro') {
    const tools: ToolDef[] = [];
    const sourceWorkspace = toolRegistry.get('source_workspace')?.def;
    const sourceBuild = toolRegistry.get('source_build')?.def;
    if (sourceWorkspace) tools.push(sourceWorkspace);
    if (sourceBuild) tools.push(sourceBuild);
    if (args.bridgeOnline && isMicroFsRelevant(args.userText)) tools.push(MICRO_FS_TOOL_DEF);
    const webSearch = args.webSearchAvailable ? toolRegistry.get('web_search')?.def : undefined;
    if (webSearch) tools.push(webSearch);
    return tools.length > 0 ? tools : undefined;
  }
  return toolRegistry.toolDefsForTurn({
    userText: args.userText,
    bridgeOnline: args.bridgeOnline,
    imageGenAvailable: args.imageGenAvailable,
    webSearchAvailable: args.webSearchAvailable,
  });
}

function isMicroFsRelevant(userText: string): boolean {
  return /\b(file|files|folder|workspace|artifact|html|css|js|json|csv|txt|md|code|script|read|write|create|make|edit|save|open)\b/i.test(userText);
}

function reservedOutputTokensForContextMode(mode: ChatContextMode): number | undefined {
  return mode === 'micro' ? MICRO_LOCAL_MAX_TOKENS : undefined;
}

function extractLocalPseudoToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let searchFrom = 0;
  while (calls.length < 3) {
    const idx = text.indexOf('fs.write', searchFrom);
    if (idx < 0) break;
    const openParen = text.indexOf('(', idx + 'fs.write'.length);
    if (openParen < 0) break;
    const inner = readBalancedParens(text, openParen);
    if (!inner) {
      searchFrom = idx + 'fs.write'.length;
      continue;
    }
    const path = readObjectStringProperty(inner, 'path');
    const content =
      readObjectStringProperty(inner, 'content') ??
      readObjectStringProperty(inner, 'contents');
    if (path && content != null) {
      calls.push({
        id: newId('tc-rescue'),
        name: 'fs',
        arguments: {
          action: 'write',
          path: normalizeRescuedWorkspacePath(path),
          content,
        },
      });
    }
    searchFrom = inner.end + 1;
  }
  return calls;
}

function readBalancedParens(text: string, openIndex: number): { value: string; end: number } | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { value: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

function readObjectStringProperty(source: { value: string } | string, key: string): string | null {
  const text = typeof source === 'string' ? source : source.value;
  const keyMatch = new RegExp(`\\b${key}\\s*:`).exec(text);
  if (!keyMatch) return null;
  let i = keyMatch.index + keyMatch[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  i += 1;
  let out = '';
  let escaped = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      out += decodeSimpleEscape(ch);
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === quote) {
      return out;
    } else {
      out += ch;
    }
  }
  return null;
}

function decodeSimpleEscape(ch: string): string {
  if (ch === 'n') return '\n';
  if (ch === 'r') return '\r';
  if (ch === 't') return '\t';
  return ch;
}

function normalizeRescuedWorkspacePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (trimmed.startsWith('/workspace/')) return trimmed;
  if (trimmed === '/workspace') return '/workspace';
  return `/workspace/${trimmed.replace(/^\/+/, '')}`;
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

function formatProviderErrorRecovery(message: AssistantMessage, error: string): string {
  const progress = summarizeToolProgress(message);
  if (!progress) return `_Error: ${error}_`;
  return [
    'I completed local tool work, but the model provider failed before I could finish the final summary.',
    `Provider error: ${error}`,
    progress,
    'You can continue from the completed tool results above without re-running the successful workspace steps.',
  ].join('\n\n');
}

function formatToolRoundCapMessage(maxRounds: number, message: AssistantMessage): string {
  const progress = summarizeToolProgress(message);
  return [
    `Stopped after ${maxRounds} tool rounds to avoid an infinite loop.`,
    progress ?? 'No completed tool results were available in this turn.',
    'You can ask me to continue from the latest tool results.',
  ].join('\n\n');
}

function formatRepeatedSideEffectLoopMessage(repeat: { path: string; action: string }): string {
  const action = repeat.action === 'append' ? 'append to' : 'write';
  return [
    `Stopped the local tool loop after it tried to ${action} the same file repeatedly.`,
    `Latest repeated path: ${repeat.path}`,
    'The successful tool results above are still available, so you can open the artifact or ask me to continue from that file.',
  ].join('\n\n');
}

function formatInterruptedToolBatchSummary(
  invalids: Array<{ index: number; call: ToolCall; validation: ToolValidationResult }>,
  firstInvalidIndex: number,
): string {
  const executed = firstInvalidIndex;
  const prefixSummary = executed === 0
    ? 'No earlier calls were executed.'
    : `${executed} earlier tool call${executed === 1 ? '' : 's'} executed before the invalid call.`;
  return [
    'status: error',
    'tool: tool_batch_policy',
    'error_code: invalid_tool_batch',
    `summary: Tool batch stopped at call ${firstInvalidIndex} because ${invalids.length} tool call${invalids.length === 1 ? '' : 's'} failed validation. ${prefixSummary} The invalid call and all later calls were not executed.`,
    'invalid_calls:',
    ...invalids.map(({ index, call, validation }) => (
      `- call ${index} (${call.name}): ${validation.summary ?? validation.errorCode ?? 'invalid tool call'}`
    )),
    'fix: Correct the invalid call and retry from that point. Do not send placeholder or empty tool arguments. For finished HTML games/apps, prefer one artifact.create_html_artifact call with a complete document under /workspace/artifacts/exports/...',
    'retryable: true',
  ].join('\n');
}

function summarizeToolProgress(message: AssistantMessage): string | null {
  const results = message.toolResults ?? [];
  if (results.length === 0) return null;
  const failures = results.filter(result => isToolFailureContent(result.toolName, result.content));
  const artifactPaths = new Set<string>();
  for (const result of results) {
    for (const artifact of result.artifacts ?? []) {
      if (artifact.kind === 'image') artifactPaths.add(artifact.path);
      if (artifact.kind === 'image-job') artifactPaths.add(`image job ${artifact.jobId}`);
    }
    for (const match of result.content.matchAll(/\/workspace\/[^\s`)"']+/g)) {
      artifactPaths.add(match[0].replace(/[.,;:]+$/, ''));
    }
  }
  const lines = [
    `Completed tool results: ${results.length}.`,
    failures.length > 0 ? `Tool results with errors: ${failures.length}.` : '',
  ].filter(Boolean);
  const paths = [...artifactPaths].slice(0, 8);
  if (paths.length > 0) {
    lines.push('Artifacts/paths seen:');
    lines.push(...paths.map(path => `- ${path}`));
    if (artifactPaths.size > paths.length) lines.push(`- ...and ${artifactPaths.size - paths.length} more`);
  }
  return lines.join('\n');
}

function formatOversizedContextMessage(used: number, window: number): string {
  return [
    `This thread is too large to send safely (${formatTokens(used)} of ${formatTokens(window)} tokens estimated).`,
    'Large tool results are still in the conversation context. Compact the thread, start a fresh thread, or reference the generated artifact paths instead of re-reading full files.',
  ].join('\n\n');
}

function safeStableJson(value: unknown): string {
  try {
    return JSON.stringify(value, Object.keys(value && typeof value === 'object' ? value as Record<string, unknown> : {}).sort());
  } catch {
    return String(value);
  }
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

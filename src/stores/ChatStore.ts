// Observable ChatStore state facade for app runtime, RootStore, and React hooks.
import { makeAutoObservable, runInAction } from 'mobx';
import type { ActivityItem, AssistantMessage, ChatSnapshot, Message, StreamActivity, Thread } from '../core/types';
import type { LlmRequest } from '../core/llm';
import { DEFAULT_MODEL_ID } from '../core/models';
import { resolveBackgroundModelId, resolveDefaultModelId } from '../core/defaultModel';
import { formatAttachmentFooter, splitAttachmentFooter, toMessageAttachmentRef } from '../core/attachments';
import { appendMessageText, messageText, setMessageText, userMessageParts } from '../core/messageParts';
import {
  branchThreadFrom,
  createEmptyThread,
  editUserMessageAndTruncate,
  normalizeActiveThreadId,
  movePinnedThread as movePinnedThreadOp,
  orderedPinnedThreads,
  regenerateThreadFromAssistant,
  renameThread as renameThreadOp,
  restoreThread as restoreThreadOp,
  softDeleteThread as softDeleteThreadOp,
  toggleThreadPinned as toggleThreadPinnedOp,
} from '../core/threadOps';
import {
  CHAT_SNAPSHOT_STORAGE_KEY,
  cancelPendingDeferredSnapshot,
  consumeSnapshotLoadError,
  loadArchivedThread,
  loadSnapshot,
  saveSnapshot,
  setCompactionNoticeHandler,
} from '../services/persistence';
import { CURRENT_CHAT_SCHEMA_VERSION } from '../services/persistence/migrations';
import { setMultiTabWriteHandler } from '../services/storage/persistenceProvider';
import type { LeaderElectionState, WebLocksLeaderElection } from '../services/storage/webLocksLeaderElection';
import { computeUsage, contextWindowFor, estimateLlmPayloadTokens, estimateTokens, type TokenUsage } from '../core/tokens';
import { StreamingTextBuffer } from '../services/streaming/StreamingTextBuffer';
import { buildRuntimeContext } from '../services/chat/runtimeContext';
import { logEvent } from '../services/diagnostics/chatLog';
import { logger } from '../services/diagnostics/logger';
import type { UndoService } from '../services/undo/UndoService';
import { createWorkspaceChatPersistence } from '../services/workspaceChatPersistence';
import {
  ChatPersistenceCoordinator,
  snapshotLatestUpdatedAt,
} from './chatPersistenceCoordinator';
import type { ToolStoreContext } from '../services/chat/toolBatchExecutor';
import {
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
import { normalizeProviderErrorMessage } from '../services/chat/turnFormatting';
import {
  type StreamingRoundActivityUpdate,
} from '../services/chat/streamingRoundExecutor';
import {
  AGENT_TASK_MAX_TOOL_ROUNDS,
  TurnRunner,
  isImageGenerationAvailable,
  type ChatThinkingEffort,
  type TurnHost,
} from '../services/chat/turnRunner';
import {
  AGENT_TASK_SLOT_RETRY_MS,
  MAX_CONCURRENT_AGENT_TASKS,
  clampAgentTaskMaxRounds,
  clampAgentTaskStartDelayMinutes,
  normalizeAgentTaskSystemPromptBody,
} from '../services/chat/agentTasks';
import {
  AutoNamer,
  type AutoNameHost,
} from '../services/chat/autoNamer';
import { threadLlmSpendUsd as threadSpendSelector } from '../core/threadSelectors';
import type { ProviderStore } from './ProviderStore';
import type { ModelRegistry } from './ModelRegistry';
import type { UserProfileStore } from './UserProfileStore';
import { appendSkillInstructionsToSystemPrompt, type WorkspaceSkill } from '../services/skills/skillsService';
import type { BridgeClientFacade } from '../services/tools/types';
import type { CompletedJob } from '../services/image/jobs/types';
import { createWelcomeTourThread, WELCOME_TOUR_THREAD_ID } from '../tourThread';

export type { ChatContextMode } from '../services/chat/contextModes';
export { PROVIDER_STREAM_INITIAL_STALL_MS, PROVIDER_STREAM_STALL_MS } from '../services/chat/streamingRoundExecutor';
export {
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  OPENROUTER_THINKING_PRESETS,
  normalizeOpenRouterThinkingEffort,
} from '../services/chat/turnRunner';
export type { ChatThinkingEffort } from '../services/chat/turnRunner';
export { MAX_CONCURRENT_AGENT_TASKS } from '../services/chat/agentTasks';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const AGENT_TASK_SUMMARY_LIMIT = 2000;

/** Observable chat state facade; turn, thread, and naming control flow live in services/core helpers. */
export class ChatStore {
  threads: Thread[] = [];
  activeThreadId: string | null = null;
  streamingByThread: Record<string, string> = {};
  streamActivityByThread: Record<string, StreamActivity> = {};
  /** Per-thread send/stream errors; only the active thread surfaces via `lastError`. */
  lastErrorByThread: Record<string, string> = {};
  /** Set when another tab writes chat storage; local saves pause until dismissed. */
  persistenceConflict: string | null = null;
  /** Visible while another Web Locks leader owns shared chat persistence. */
  activeTabNotice: string | null = null;
  /** User-visible notice after an emergency compaction save. */
  compactionNotice: string | null = null;
  /** Archived thread ids currently loading their full message history. */
  hydratingThreadIds: Record<string, boolean> = {};

  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private readonly profile: UserProfileStore;
  private readonly controllersByThread = new Map<string, AbortController>();
  private readonly autoNamer: AutoNamer;
  private readonly turnRunner: TurnRunner;
  private readonly textBuffer = new StreamingTextBuffer();
  private readonly persistence: ChatPersistenceCoordinator;
  private readonly leaderElection: WebLocksLeaderElection | null;
  private stopLeaderElectionSubscription: (() => void) | null = null;
  private readonly hydrationByThread = new Map<string, Promise<Thread | null>>();
  private readonly agentTaskStartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private workspacePersistenceHydrating = false;
  private recentSummariesProvider: (() => string[]) | null = null;
  private semanticContextProvider: ((userText: string) => string | Promise<string>) | null = null;
  private toolStoresProvider: (() => ToolStoreContext) | null = null;
  private activeSkillProvider: ((threadId: string) => WorkspaceSkill | undefined) | null = null;
  private readonly isAutoNamingEnabled: () => boolean;
  private readonly undoService: UndoService | null;

  constructor(
    providers: ProviderStore,
    registry: ModelRegistry,
    profile: UserProfileStore,
    isAutoNamingEnabled: () => boolean = () => true,
    leaderElection: WebLocksLeaderElection | null = null,
    undoService: UndoService | null = null,
  ) {
    this.providers = providers;
    this.registry = registry;
    this.profile = profile;
    this.isAutoNamingEnabled = isAutoNamingEnabled;
    this.leaderElection = leaderElection;
    this.undoService = undoService;
    this.autoNamer = new AutoNamer({
      host: this.createAutoNameHost(),
      router: this.providers.router,
    });
    this.turnRunner = new TurnRunner({
      host: this.createTurnHost(),
      router: this.providers.router,
      registry: this.registry,
      profile: this.profile,
      chat: this,
      createId: newId,
      getToolStores: () => this.toolStoresProvider?.(),
      getRecentSummaries: () => this.recentSummariesProvider?.() ?? [],
      getSemanticContext: userText => this.semanticContextProvider?.(userText) ?? '',
      getActiveSkill: threadId => this.activeSkillProvider?.(threadId),
    });
    const snapshot = loadSnapshot();
    if (snapshot) {
      this.applySnapshot(snapshot);
    } else {
      const thread = createEmptyThread(newId('t'), Date.now(), this.defaultModelId);
      this.threads = [thread];
      this.activeThreadId = thread.id;
    }
    const snapshotLoadError = consumeSnapshotLoadError();
    if (snapshotLoadError) this.compactionNotice = snapshotLoadError;
    setMultiTabWriteHandler(key => {
      // With Web Locks, only the elected leader can write. Ignore storage
      // events in that mode; this callback is retained for feature fallback.
      if (this.leaderElection && !this.leaderElection.usesLegacyFallback) return;
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
    makeAutoObservable<this, 'providers' | 'registry' | 'profile' | 'controllersByThread' | 'autoNamer' | 'turnRunner' | 'textBuffer' | 'persistence' | 'leaderElection' | 'stopLeaderElectionSubscription' | 'hydrationByThread' | 'agentTaskStartTimers' | 'workspacePersistenceHydrating' | 'recentSummariesProvider' | 'semanticContextProvider' | 'toolStoresProvider' | 'activeSkillProvider' | 'isAutoNamingEnabled' | 'undoService'>(this, {
      providers: false,
      registry: false,
      profile: false,
      controllersByThread: false,
      autoNamer: false,
      turnRunner: false,
      textBuffer: false,
      persistence: false,
      leaderElection: false,
      stopLeaderElectionSubscription: false,
      hydrationByThread: false,
      agentTaskStartTimers: false,
      workspacePersistenceHydrating: false,
      recentSummariesProvider: false,
      semanticContextProvider: false,
      toolStoresProvider: false,
      activeSkillProvider: false,
      isAutoNamingEnabled: false,
      undoService: false,
    });

    // The coordinator owns the throttled autosave, unload flush, and the
    // workspace save queue; the autorun it installs tracks `this.snapshot`
    // (plus deep thread fields) through the callback below.
    this.persistence = new ChatPersistenceCoordinator(() => this.snapshot);
    if (this.leaderElection) {
      this.stopLeaderElectionSubscription = this.leaderElection.subscribe(state => this.applyLeaderElectionState(state));
    }
    this.persistence.start();
    if (this.activeThread?.archived) {
      void this.hydrateThread(this.activeThread.id);
    }
  }

  private createTurnHost(): TurnHost {
    return {
      getThread: threadId => this.findThread(threadId),
      appendAssistantMessage: (threadId, message) => {
        runInAction(() => {
          this.appendMessage(threadId, message);
          this.streamingByThread[threadId] = message.id;
        });
      },
      ownsTurn: (threadId, messageId) => this.ownsStreamingTurn(threadId, messageId),
      queueTextChunk: (threadId, messageId, chunk) => this.queueTextChunk(threadId, messageId, chunk),
      flushText: messageId => this.textBuffer.flush(messageId),
      cancelText: messageId => this.textBuffer.cancel(messageId),
      clearStreamingState: (threadId, messageId) => {
        runInAction(() => this.clearStreamingState(threadId, messageId));
      },
      applyRoundActivityUpdate: (threadId, messageId, update) =>
        this.applyRoundActivityUpdate(threadId, messageId, update),
      markStreamActivityPhase: (threadId, messageId, phase) =>
        this.markStreamActivityPhase(threadId, messageId, phase),
      updateAssistantMessage: (threadId, messageId, updater, options) => {
        let updated: AssistantMessage | undefined;
        runInAction(() => {
          const message = this.findMessage(threadId, messageId);
          if (!message || message.role !== 'assistant') return;
          updater(message);
          if (options?.touch) this.touchMessage(threadId, messageId);
          updated = message;
        });
        return updated;
      },
      replaceToolResultContent: (result, content) => {
        runInAction(() => {
          result.content = content;
        });
      },
      setThreadLastError: (threadId, message) => {
        runInAction(() => this.setThreadLastError(threadId, message));
      },
      maybeAutoName: (threadId, assistantMessage) => this.autoNamer.maybeAutoName(threadId, assistantMessage),
    };
  }

  private createAutoNameHost(): AutoNameHost {
    return {
      isAutoNamingEnabled: this.isAutoNamingEnabled,
      getThread: threadId => this.findThread(threadId),
      getModelCandidates: fallbackModelId => this.backgroundModelCandidates(fallbackModelId),
      setThreadNaming: (threadId, naming) => {
        runInAction(() => {
          const thread = this.findThread(threadId);
          if (thread) thread.naming = naming;
        });
      },
      applyThreadTitle: (threadId, title) => {
        runInAction(() => {
          const thread = this.findThread(threadId);
          if (!thread || thread.autoNamed || thread.deletedAt != null) return;
          thread.title = title;
          thread.autoNamed = true;
        });
      },
    };
  }

  dispose(): void {
    this.abortAllStreams();
    this.clearAgentTaskStartTimers();
    this.stopLeaderElectionSubscription?.();
    this.stopLeaderElectionSubscription = null;
    this.persistence.dispose();
  }

  /** True while a different tab owns the Web Locks persistence lease. */
  get isReadOnlyFollower(): boolean {
    return this.activeTabNotice != null;
  }

  get snapshot(): ChatSnapshot {
    return {
      schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
      threads: this.threads,
      activeThreadId: this.activeThreadId,
    };
  }

  get activeThread(): Thread | null {
    return this.threads.find(t => t.id === this.activeThreadId) ?? null;
  }

  get defaultModelId(): string {
    return resolveDefaultModelId({
      hasOpenRouterKey: !!this.providers.getConfig('openrouter').apiKey,
      ollamaOnline: this.providers.getConfig('ollama').available === true,
      localModels: this.registry.all.filter(model => model.providerId === 'ollama'),
      registry: this.registry,
    });
  }

  get backgroundModelId(): string | null {
    return resolveBackgroundModelId({
      hasOpenRouterKey: !!this.providers.getConfig('openrouter').apiKey,
      ollamaOnline: this.providers.getConfig('ollama').available === true,
      localModels: this.registry.all.filter(model => model.providerId === 'ollama'),
      registry: this.registry,
    });
  }

  private backgroundModelCandidates(fallbackModelId: string): string[] {
    const ids = [this.backgroundModelId, fallbackModelId, this.defaultModelId]
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)];
  }

  reconcileDefaultModelForEmptyThreads(): void {
    const nextDefault = this.defaultModelId;
    if (nextDefault === DEFAULT_MODEL_ID) return;
    let changed = false;
    for (const thread of this.threads) {
      if (thread.deletedAt != null || thread.messages.length > 0 || thread.modelId !== DEFAULT_MODEL_ID) continue;
      thread.modelId = nextDefault;
      thread.contextMode = 'micro';
      changed = true;
    }
    if (changed) this.schedulePersistSnapshot(this.snapshot);
  }

  get activeThreadHydrating(): boolean {
    return this.activeThreadId ? this.isThreadHydrating(this.activeThreadId) : false;
  }

  isThreadHydrating(threadId: string): boolean {
    return this.hydratingThreadIds[threadId] === true;
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

  private get tokenUsageBase(): {
    window: number;
    isLocalImage: boolean;
    baseUsed: number;
  } {
    const thread = this.activeThread;
    const model = this.registry.findById(thread?.modelId ?? '') ?? this.registry.findById(this.defaultModelId);
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
      semanticRecallAvailable: extras?.rag?.active ?? false,
      spawnTaskAvailable: !thread.agentTask && this.runningAgentTaskCount() < MAX_CONCURRENT_AGENT_TASKS,
      spawnTaskRunningCount: this.runningAgentTaskCount(),
      spawnTaskMaxConcurrent: MAX_CONCURRENT_AGENT_TASKS,
      toolAllowlist: this.activeSkillProvider?.(thread.id)?.tools,
    });
    const activeSkill = this.activeSkillProvider?.(thread.id);
    const systemPrompt = appendSkillInstructionsToSystemPrompt(systemPromptForContextMode(mode, () =>
      this.profile.composeSystemPrompt({
          runtimeContext: buildRuntimeContext({ bridge }),
          threadContext: mode === 'full' ? thread.threadContext : undefined,
          recentSummaries: mode === 'full' ? this.recentSummariesProvider?.() ?? [] : [],
        })
    ), activeSkill);
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
    const draftCost = draftText.trim()
      ? estimateTokens(draftText) + 4
      : 0;
    return computeUsage(baseUsed + draftCost, window);
  }

  selectThread(id: string): boolean {
    if (this.activeThreadId === id) return true;
    const thread = this.ensureThreadModel(id);
    if (!thread || thread.deletedAt != null) return false;
    this.activeThreadId = id;
    if (thread.archived) void this.hydrateThread(id);
    return true;
  }

  createThread(): string {
    const thread = createEmptyThread(newId('t'), Date.now(), this.defaultModelId);
    this.threads.unshift(thread);
    this.activeThreadId = thread.id;
    return thread.id;
  }

  /** Adds the bundled reference conversation without changing the active draft thread. */
  seedWelcomeTour(): boolean {
    if (this.threads.some(thread => thread.id === WELCOME_TOUR_THREAD_ID)) return false;
    const tour = createWelcomeTourThread({ modelId: this.defaultModelId, now: Date.now() });
    this.threads.unshift(tour);
    this.schedulePersistSnapshot(this.snapshot);
    return true;
  }

  hasRunningAgentTask(): boolean {
    return this.runningAgentTaskCount() > 0;
  }

  runningAgentTaskCount(): number {
    return this.threads.filter(thread =>
      thread.agentTask === true
      && thread.deletedAt == null
      && (thread.agentTaskStatus === 'running' || this.isThreadStreaming(thread.id))
    ).length;
  }

  get visibleAgentTaskThreads(): Thread[] {
    return this.visibleThreads.filter(thread => thread.agentTask === true);
  }

  get visibleConversationThreads(): Thread[] {
    const conversations = this.visibleThreads.filter(thread => thread.agentTask !== true);
    const pinned = orderedPinnedThreads(conversations);
    return [...pinned, ...conversations.filter(thread => !thread.pinned)];
  }

  spawnTask(
    input: {
      title: string;
      instructions: string;
      model?: string;
      system_prompt?: string;
      max_rounds?: number;
      start_delay_minutes?: number;
    },
    originThreadId: string,
  ): { ok: boolean; message: string; threadId?: string } {
    const origin = this.ensureThreadModel(originThreadId);
    if (!origin || origin.deletedAt != null) {
      return { ok: false, message: 'Unable to start background task: origin thread is unavailable.' };
    }
    if (origin.agentTask) {
      return { ok: false, message: 'Unable to start background task: agent tasks cannot spawn nested tasks.' };
    }

    const now = Date.now();
    const title = normalizeAgentTaskTitle(input.title);
    const instructions = input.instructions.trim();
    const modelId = this.resolveAgentTaskModelId(input.model, origin);
    if (!modelId) {
      return { ok: false, message: 'Unable to start background task: no local or cloud chat model is available.' };
    }
    const maxRounds = clampAgentTaskMaxRounds(input.max_rounds);
    const systemPrompt = normalizeAgentTaskSystemPromptBody(input.system_prompt);
    const delayMinutes = clampAgentTaskStartDelayMinutes(input.start_delay_minutes);
    const scheduledStartAt = delayMinutes > 0 ? now + Math.round(delayMinutes * 60_000) : undefined;
    if (!scheduledStartAt && this.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS) {
      return {
        ok: false,
        message: `Unable to start background task: all ${MAX_CONCURRENT_AGENT_TASKS} background task slots are in use.`,
      };
    }
    const thread: Thread = {
      id: newId('t'),
      title: `Agent: ${title}`,
      subtitle: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      modelId,
      messages: [{
        id: newId('m'),
        role: 'user',
        content: instructions,
        createdAt: now,
      }],
      agentTask: true,
      agentTaskOriginThreadId: origin.id,
      agentTaskStatus: scheduledStartAt ? 'scheduled' : 'running',
      ...(scheduledStartAt ? { agentTaskScheduledStartAt: scheduledStartAt } : {}),
      ...(systemPrompt ? { agentTaskSystemPrompt: systemPrompt } : {}),
      agentTaskMaxRounds: maxRounds,
      autoNamed: true,
    };
    this.threads.unshift(thread);
    this.schedulePersistSnapshot(this.snapshot);
    if (scheduledStartAt) {
      this.armScheduledAgentTask(thread.id, scheduledStartAt - now);
      return {
        ok: true,
        message: `Task '${title}' scheduled to start at ${new Date(scheduledStartAt).toISOString()}.`,
        threadId: thread.id,
      };
    }
    this.startAgentTaskTurn(thread.id);
    return {
      ok: true,
      message: `Task '${title}' started in background.`,
      threadId: thread.id,
    };
  }

  setThreadModel(threadId: string, modelId: string): void {
    this.updateThread(threadId, () => ({ modelId }));
  }

  private resolveAgentTaskModelId(inputModelId: string | undefined, origin: Thread): string | null {
    const explicit = inputModelId ? this.registry.findById(inputModelId) : undefined;
    if (explicit && this.providers.isConnected(explicit.providerId)) return explicit.id;

    const originModel = this.registry.findById(origin.modelId);
    if (originModel && this.providers.isConnected(originModel.providerId)) return origin.modelId;

    const fallbackId = this.backgroundModelId ?? this.defaultModelId;
    const fallback = this.registry.findById(fallbackId);
    return fallback && this.providers.isConnected(fallback.providerId) ? fallback.id : null;
  }

  setThreadContextMode(threadId: string, mode: ChatContextMode): void {
    this.updateThread(threadId, () => ({ contextMode: mode }));
  }

  setThreadThinkingEffort(threadId: string, effort: ChatThinkingEffort): void {
    this.updateThread(threadId, () => ({ thinkingEffort: effort }));
  }

  setThreadSkill(threadId: string, skillId: string | undefined): void {
    this.updateThread(threadId, () => ({ skillId }));
  }

  setRecentSummariesProvider(fn: () => string[]): void {
    this.recentSummariesProvider = fn;
  }

  setSemanticContextProvider(fn: (userText: string) => string | Promise<string>): void {
    this.semanticContextProvider = fn;
  }

  setActiveSkillProvider(fn: (threadId: string) => WorkspaceSkill | undefined): void {
    this.activeSkillProvider = fn;
  }

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
    const activeModel = this.registry.findById(this.activeThread?.modelId);
    const modelId = activeModel && this.providers.isConnected(activeModel.providerId)
      ? activeModel.id
      : this.backgroundModelId ?? this.defaultModelId;
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
    void job;
  }

  setThreadContext(threadId: string, context: string): void {
    this.updateThread(threadId, () => ({ threadContext: context }));
  }

  renameThread(threadId: string, title: string): void {
    runInAction(() => {
      const thread = this.findThread(threadId);
      if (thread?.readOnly) return;
      const next = thread ? renameThreadOp(thread, title, Date.now()) : null;
      if (next) this.replaceThread(next);
    });
  }

  clearAllThreads(): void {
    const previousThreads = deepClone(this.threads);
    const previousActiveThreadId = this.activeThreadId;
    const previousErrors = { ...this.lastErrorByThread };
    this.abortAllStreams();
    this.clearAgentTaskStartTimers();
    const thread = createEmptyThread(newId('t'), Date.now(), this.defaultModelId);
    this.threads = [thread];
    this.activeThreadId = thread.id;
    this.lastErrorByThread = {};
    this.undoService?.register({
      label: 'Delete all threads',
      undo: () => runInAction(() => {
        this.clearAgentTaskStartTimers();
        this.threads = deepClone(previousThreads);
        this.activeThreadId = normalizeActiveThreadId(this.threads, previousActiveThreadId);
        this.lastErrorByThread = { ...previousErrors };
        for (const restored of this.threads) {
          if (restored.agentTaskStatus !== 'scheduled' || restored.deletedAt != null) continue;
          const dueAt = restored.agentTaskScheduledStartAt ?? Date.now();
          this.armScheduledAgentTask(restored.id, Math.max(0, dueAt - Date.now()));
        }
        this.schedulePersistSnapshot(this.snapshot);
      }),
    });
  }

  applyImportedSnapshot(snapshot: ChatSnapshot): void {
    this.abortAllStreams();
    this.clearAgentTaskStartTimers();
    this.applySnapshot(snapshot);
    this.streamActivityByThread = {};
    this.lastErrorByThread = {};
    this.persistenceConflict = null;
    this.resumePersistenceIfLeader();
    this.schedulePersistSnapshot(this.snapshot);
  }

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

  get visibleThreads(): Thread[] {
    return this.threads.filter(t => t.deletedAt == null);
  }

  softDeleteThread(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null) return;
    const previousActiveThreadId = this.activeThreadId;
    if (thread.agentTaskStatus === 'scheduled') this.cancelScheduledAgentTask(threadId);
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
    runInAction(() => {
      const now = Date.now();
      const previousThread = deepClone(this.findThread(threadId)!);
      const previousIndex = this.threads.findIndex(item => item.id === threadId);
      const fallbackThread = this.activeThreadId === threadId && this.visibleThreads.length <= 1
        ? createEmptyThread(newId('t'), now, this.defaultModelId)
        : undefined;
      const result = softDeleteThreadOp(this.threads, {
        threadId,
        activeThreadId: this.activeThreadId,
        now,
        fallbackThread,
      });
      if (!result.changed) return;
      this.threads = result.threads;
      this.activeThreadId = result.activeThreadId;
      this.schedulePersistSnapshot(this.snapshot);
      this.undoService?.register({
        label: `Delete “${previousThread.title}”`,
        undo: () => runInAction(() => {
          const currentIndex = this.threads.findIndex(item => item.id === threadId);
          if (currentIndex >= 0) {
            this.threads[currentIndex] = deepClone(previousThread);
          } else {
            this.threads.splice(Math.max(0, previousIndex), 0, deepClone(previousThread));
          }
          this.activeThreadId = normalizeActiveThreadId(this.threads, previousActiveThreadId);
          if (previousThread.agentTaskStatus === 'scheduled') {
            const dueAt = previousThread.agentTaskScheduledStartAt ?? Date.now();
            this.armScheduledAgentTask(previousThread.id, Math.max(0, dueAt - Date.now()));
          }
          this.schedulePersistSnapshot(this.snapshot);
        }),
      });
    });
  }

  restoreThread(threadId: string): void {
    runInAction(() => {
      const thread = this.findThread(threadId);
      const next = thread ? restoreThreadOp(thread, Date.now()) : null;
      if (next) this.replaceThread(next);
    });
  }

  toggleThreadPinned(threadId: string): void {
    runInAction(() => {
      const thread = this.findThread(threadId);
      if (!thread) return;
      const pinned = orderedPinnedThreads(this.threads);
      const next = toggleThreadPinnedOp(thread, Date.now(), thread.pinned ? undefined : pinned.length);
      if (!next) return;
      if (thread.pinned) {
        this.replaceThread(next);
        return;
      }
      const orderById = new Map(pinned.map((item, index) => [item.id, index]));
      this.threads = this.threads.map(item => {
        if (item.id === threadId) return next;
        const pinOrder = orderById.get(item.id);
        return pinOrder === undefined || item.pinOrder === pinOrder ? item : { ...item, pinOrder };
      });
      this.schedulePersistSnapshot(this.snapshot);
    });
  }

  movePinnedThread(sourceId: string, targetId: string): void {
    runInAction(() => {
      const next = movePinnedThreadOp(this.threads, sourceId, targetId);
      if (!next) return;
      this.threads = next;
      this.schedulePersistSnapshot(this.snapshot);
    });
  }

  branchFrom(threadId: string, messageId: string): string | null {
    const source = this.findThread(threadId);
    if (!source || source.deletedAt != null || source.readOnly) return null;
    if (this.isThreadStreaming(source.id)) return null;
    let branchId: string | null = null;
    runInAction(() => {
      const branch = branchThreadFrom(source, {
        messageId,
        newThreadId: newId('t'),
        now: Date.now(),
      });
      if (!branch) return;
      this.threads.unshift(branch);
      this.schedulePersistSnapshot(this.snapshot);
      branchId = branch.id;
    });
    return branchId;
  }

  branchThreadFromMessage(threadId: string, messageId: string): string | null {
    return this.branchFrom(threadId, messageId);
  }

  regenerate(threadId: string, messageId: string): string | null {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null || thread.readOnly) return null;
    if (this.isThreadStreaming(thread.id)) return null;
    let resultId: string | null = null;
    runInAction(() => {
      const next = regenerateThreadFromAssistant(thread, messageId, Date.now());
      if (!next) return;
      this.replaceThread(next);
      resultId = next.id;
    });
    if (resultId) this.startTurn(resultId, true);
    return resultId;
  }

  regenerateFromMessage(threadId: string, messageId: string): string | null {
    return this.regenerate(threadId, messageId);
  }

  editAndResend(threadId: string, messageId: string, text: string): string | null {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null || thread.readOnly) return null;
    if (this.isThreadStreaming(thread.id)) return null;
    let resultId: string | null = null;
    runInAction(() => {
      const next = editUserMessageAndTruncate(thread, messageId, text, Date.now());
      if (!next) return;
      this.replaceThread(next);
      resultId = next.id;
    });
    if (resultId) this.startTurn(resultId, true);
    return resultId;
  }

  editAndResendFromMessage(threadId: string, messageId: string, text: string): string | null {
    return this.editAndResend(threadId, messageId, text);
  }

  sendMessage(text: string, attachments: { id?: string; filename: string; path: string; size: number; mime: string }[] = []): void {
    const thread = this.ensureThreadModel(this.activeThreadId);
    const trimmed = text.trim();
    if (!thread || thread.readOnly || (!trimmed && attachments.length === 0)) return;
    if (thread.archived) {
      void this.sendMessageAfterHydration(thread.id, text, attachments);
      return;
    }
    this.sendMessageToHydratedThread(thread.id, trimmed, attachments);
  }

  private sendMessageToHydratedThread(
    threadId: string,
    trimmed: string,
    attachments: { id?: string; filename: string; path: string; size: number; mime: string }[] = [],
  ): void {
    const thread = this.ensureThreadModel(threadId);
    if (!thread || thread.readOnly || thread.archived || (!trimmed && attachments.length === 0)) return;
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
      parts: userMessageParts((trimmed + attachmentFooter).trim() || '(see attachments)', refs),
      createdAt: Date.now(),
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

  private async sendMessageAfterHydration(
    threadId: string,
    text: string,
    attachments: { id?: string; filename: string; path: string; size: number; mime: string }[] = [],
  ): Promise<void> {
    const thread = await this.hydrateThread(threadId);
    if (!thread || thread.deletedAt != null || thread.readOnly) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    runInAction(() => {
      this.activeThreadId = thread.id;
      this.sendMessageToHydratedThread(thread.id, trimmed, attachments);
    });
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
        const partial = messageText(message).trim();
        setMessageText(message, partial ? `${messageText(message)}\n\n*[interrupted]*` : '*[no response]*');
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

  private hydrateThread(threadId: string): Promise<Thread | null> {
    const existing = this.findThread(threadId);
    if (!existing) return Promise.resolve(null);
    if (!existing.archived) return Promise.resolve(existing);
    const inFlight = this.hydrationByThread.get(threadId);
    if (inFlight) return inFlight;

    runInAction(() => {
      this.hydratingThreadIds = { ...this.hydratingThreadIds, [threadId]: true };
    });

    const promise = loadArchivedThread(threadId)
      .then(thread => {
        if (!thread || thread.id !== threadId) {
          runInAction(() => {
            this.setThreadLastError(threadId, 'Archived conversation could not be loaded from browser storage.');
          });
          return null;
        }

        return runInAction(() => {
          const idx = this.threads.findIndex(item => item.id === threadId);
          if (idx < 0) return null;
          const current = this.threads[idx];
          if (!current.archived) return current;
          const hydrated = this.registry.findById(thread.modelId)
            ? thread
            : { ...thread, modelId: this.defaultModelId };
          const next = { ...hydrated };
          delete next.archived;
          this.threads[idx] = next;
          return this.threads[idx];
        });
      })
      .catch(err => {
        logger.warn('persistence', 'archived thread hydration failed', { threadId, err });
        runInAction(() => {
          this.setThreadLastError(threadId, 'Archived conversation could not be loaded from browser storage.');
        });
        return null;
      })
      .finally(() => {
        runInAction(() => {
          const next = { ...this.hydratingThreadIds };
          delete next[threadId];
          this.hydratingThreadIds = next;
          this.hydrationByThread.delete(threadId);
        });
      });
    this.hydrationByThread.set(threadId, promise);
    return promise;
  }

  private ensureThreadModel(threadId: string | null): Thread | null {
    if (!threadId) return null;
    const thread = this.findThread(threadId);
    if (!thread) return null;
    if (this.registry.findById(thread.modelId)) return thread;
    thread.modelId = this.defaultModelId;
    return thread;
  }

  private startAgentTaskTurn(threadId: string): void {
    const thread = this.ensureThreadModel(threadId);
    if (!thread || !thread.agentTask || thread.messages.length === 0) return;
    const originThreadId = thread.agentTaskOriginThreadId;
    if (!originThreadId) return;
    const title = displayAgentTaskTitle(thread.title);
    this.cancelScheduledAgentTask(thread.id);
    thread.agentTaskStatus = 'running';
    delete thread.agentTaskScheduledStartAt;
    thread.updatedAt = Date.now();
    const controller = new AbortController();
    this.controllersByThread.set(thread.id, controller);
    this.runTurn(thread.id, controller.signal, false, {
      maxToolRounds: clampAgentTaskMaxRounds(thread.agentTaskMaxRounds ?? AGENT_TASK_MAX_TOOL_ROUNDS),
    })
      .then(() => {
        this.finalizeAgentTask(thread.id, originThreadId, title, controller.signal.aborted ? 'interrupted' : 'done');
      })
      .catch(err => runInAction(() => {
        logger.error('chat', 'agent task run failed', { threadId: thread.id, err });
        this.setThreadLastError(thread.id, (err as Error).message);
        if (this.controllersByThread.get(thread.id) === controller) {
          this.clearStreamingState(thread.id);
        }
        this.finalizeAgentTask(thread.id, originThreadId, title, 'error', (err as Error).message);
      }));
  }

  private armScheduledAgentTask(threadId: string, delayMs: number): void {
    this.cancelScheduledAgentTask(threadId);
    const timer = setTimeout(() => {
      this.agentTaskStartTimers.delete(threadId);
      runInAction(() => this.tryStartScheduledAgentTask(threadId));
    }, Math.max(0, delayMs));
    this.agentTaskStartTimers.set(threadId, timer);
  }

  private cancelScheduledAgentTask(threadId: string): void {
    const timer = this.agentTaskStartTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.agentTaskStartTimers.delete(threadId);
  }

  private clearAgentTaskStartTimers(): void {
    for (const timer of this.agentTaskStartTimers.values()) clearTimeout(timer);
    this.agentTaskStartTimers.clear();
  }

  private tryStartScheduledAgentTask(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.deletedAt != null || thread.agentTask !== true || thread.agentTaskStatus !== 'scheduled') return;
    const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
    const remainingMs = dueAt - Date.now();
    if (remainingMs > 0) {
      this.armScheduledAgentTask(thread.id, remainingMs);
      return;
    }
    if (this.runningAgentTaskCount() >= MAX_CONCURRENT_AGENT_TASKS) {
      this.armScheduledAgentTask(thread.id, AGENT_TASK_SLOT_RETRY_MS);
      return;
    }
    this.startAgentTaskTurn(thread.id);
    this.schedulePersistSnapshot(this.snapshot);
  }

  private startDueScheduledAgentTasks(): void {
    let started = false;
    for (const thread of this.threads) {
      if (thread.agentTask !== true || thread.agentTaskStatus !== 'scheduled' || thread.deletedAt != null) continue;
      const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
      if (dueAt <= Date.now() && this.runningAgentTaskCount() < MAX_CONCURRENT_AGENT_TASKS) {
        this.startAgentTaskTurn(thread.id);
        started = true;
      }
    }
    if (started) this.schedulePersistSnapshot(this.snapshot);
  }

  private finalizeAgentTask(
    threadId: string,
    originThreadId: string,
    title: string,
    status: NonNullable<Thread['agentTaskStatus']>,
    errorMessage?: string,
  ): void {
    runInAction(() => {
      const thread = this.findThread(threadId);
      if (!thread || thread.agentTask !== true || thread.agentTaskStatus !== 'running') return;
      thread.agentTaskStatus = status;
      thread.updatedAt = Date.now();
      const summary = summarizeAgentTaskThread(thread, status, errorMessage);
      this.appendActivityEventToThread(originThreadId, {
        id: `agent-task-${threadId}-${Date.now()}`,
        kind: 'agent-task',
        state: status === 'error' ? 'failed' : status === 'interrupted' ? 'cancelled' : 'done',
        verb: `Background task '${title}' finished`,
        target: 'see thread',
        summary,
        detail: summary ? { type: 'markdown', content: summary } : undefined,
        startedAt: thread.createdAt,
        finishedAt: Date.now(),
        linkThreadId: threadId,
      });
      this.schedulePersistSnapshot(this.snapshot);
      this.startDueScheduledAgentTasks();
    });
  }

  private async runTurn(
    threadId: string,
    signal: AbortSignal,
    isReplacingInterruptedReply = false,
    options: { maxToolRounds?: number } = {},
  ): Promise<void> {
    await this.turnRunner.run(threadId, signal, { isReplacingInterruptedReply, maxToolRounds: options.maxToolRounds });
  }

  private findThread(id: string): Thread | undefined {
    return this.threads.find(t => t.id === id);
  }

  private applySnapshot(snapshot: ChatSnapshot): void {
    this.clearAgentTaskStartTimers();
    this.threads = snapshot.threads.map(thread =>
      this.registry.findById(thread.modelId)
        ? thread
        : { ...thread, modelId: this.defaultModelId }
    );
    this.activeThreadId = normalizeActiveThreadId(this.threads, snapshot.activeThreadId);
    if (!this.activeThreadId) {
      const thread = createEmptyThread(newId('t'), Date.now(), this.defaultModelId);
      this.threads = [thread];
      this.activeThreadId = thread.id;
    }
    this.reconcileAgentTasksOnBoot();
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

  private appendMessage(threadId: string, message: Message): void {
    const thread = this.findThread(threadId);
    // Never write into a soft-deleted thread. A turn aborted by soft-delete can
    // still have async tool results / image-job notifications in flight; letting
    // them land would resurrect content if the user later hits Undo.
    if (!thread || thread.deletedAt != null) return;
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if ((thread.title === 'New conversation' || !thread.title) && message.role === 'user') {
      // Provisional placeholder only - derived from what the user typed, with
      // the attachment footer stripped so it never leaks "[Attached: ...]" text.
      // Auto-naming intentionally replaces this once the first turn completes.
      const body = splitAttachmentFooter(messageText(message)).body;
      const title = body.replace(/\s+/g, ' ').trim().slice(0, 40);
      thread.title = title || 'New conversation';
    }
  }

  private appendActivityEventToThread(threadId: string, event: ActivityItem): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (message.role !== 'assistant') continue;
      const existing = message.activityEvents ?? [];
      if (existing.some(item => item.id === event.id || (item.kind === 'agent-task' && item.linkThreadId === event.linkThreadId))) return;
      message.activityEvents = [...existing, event].slice(-12);
      thread.updatedAt = Date.now();
      return;
    }
  }

  private reconcileAgentTasksOnBoot(): void {
    for (const thread of this.threads) {
      if (thread.agentTask !== true) continue;
      if (thread.agentTaskStatus === 'scheduled') {
        const dueAt = thread.agentTaskScheduledStartAt ?? Date.now();
        this.armScheduledAgentTask(thread.id, Math.max(0, dueAt - Date.now()));
        continue;
      }
      if (thread.agentTaskStatus !== 'running') continue;
      thread.agentTaskStatus = 'interrupted';
      thread.updatedAt = Date.now();
      const lastAssistant = findLastAssistant(thread);
      if (lastAssistant) {
        const partial = messageText(lastAssistant).trim();
        setMessageText(lastAssistant, partial ? `${messageText(lastAssistant)}\n\n*[interrupted]*` : '*[no response - background task interrupted]*');
      }
      if (thread.agentTaskOriginThreadId) {
        this.appendActivityEventToThread(thread.agentTaskOriginThreadId, {
          id: `agent-task-${thread.id}-boot-interrupted`,
          kind: 'agent-task',
          state: 'cancelled',
          verb: `Background task '${displayAgentTaskTitle(thread.title)}' finished`,
          target: 'see thread',
          summary: 'Interrupted because the app closed or reloaded while the task was running.',
          detail: { type: 'markdown', content: 'Interrupted because the app closed or reloaded while the task was running.' },
          startedAt: thread.createdAt,
          finishedAt: Date.now(),
          linkThreadId: thread.id,
        });
      }
    }
  }

  private appendChunk(threadId: string, messageId: string, chunk: string): void {
    const message = this.findMessage(threadId, messageId);
    if (message) appendMessageText(message, chunk);
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

  /** Apply Web Locks ownership changes to persistence and the thin UI surface. */
  private applyLeaderElectionState(state: LeaderElectionState): void {
    if (state === 'follower') {
      this.persistence.pause();
      cancelPendingDeferredSnapshot();
      this.activeTabNotice =
        'Another tab is active. This tab is read-only and will refresh automatically when it becomes active.';
      return;
    }

    this.activeTabNotice = null;
    this.resumePersistenceIfLeader();
    if (state === 'leader') {
      // Reuse the existing conflict-refresh machinery before this tab writes
      // anything, so its memory catches up with the previous leader.
      this.reloadFromStorage();
    }
  }

  /** Reload chat state from localStorage after another tab wrote newer data. */
  reloadFromStorage(): void {
    const snapshot = loadSnapshot();
    runInAction(() => {
      // Stop any in-flight stream first: the thread list is about to be replaced
      // wholesale, and an abandoned turn would otherwise keep mutating (and
      // re-saving) state that no longer matches what's on disk.
      this.abortAllStreams();
      this.clearAgentTaskStartTimers();
      if (snapshot) {
        logger.info('persistence', 'Reloaded chat from localStorage after multi-tab conflict');
        this.applySnapshot(snapshot);
      } else {
        // The other tab cleared storage. Adopt that empty state instead of
        // keeping stale in-memory threads that would just re-save (and
        // resurrect data the user deleted in the other tab).
        logger.info('persistence', 'Storage cleared by another tab; resetting to an empty conversation');
        const thread = createEmptyThread(newId('t'), Date.now(), this.defaultModelId);
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
    this.resumePersistenceIfLeader();
  }

  private resumePersistenceIfLeader(): void {
    if (this.leaderElection?.canWrite === false) return;
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
    if (current.readOnly) return current;
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

  private replaceThread(thread: Thread): Thread | null {
    const idx = this.threads.findIndex(t => t.id === thread.id);
    if (idx < 0) return null;
    this.threads[idx] = thread;
    this.schedulePersistSnapshot(this.snapshot);
    return thread;
  }

  private touchMessage(threadId: string, messageId: string): void {
    const message = this.findMessage(threadId, messageId);
    if (message) message.createdAt = Date.now();
  }
}

function normalizeProviderErrorForBanner(message: string): string {
  return normalizeProviderErrorMessage(message);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeAgentTaskTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Background task';
}

function displayAgentTaskTitle(title: string): string {
  return title.startsWith('Agent: ') ? title.slice('Agent: '.length) : title;
}

function findLastAssistant(thread: Thread): AssistantMessage | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

function summarizeAgentTaskThread(
  thread: Thread,
  status: NonNullable<Thread['agentTaskStatus']>,
  errorMessage?: string,
): string {
  const assistant = findLastAssistant(thread);
  let summary = (assistant ? messageText(assistant).trim() : '') || errorMessage || 'Background task finished without a final summary.';
  if (status === 'interrupted') summary = summary.includes('interrupted') ? summary : `${summary}\n\n[interrupted]`;
  if (status === 'error' && errorMessage && !summary.includes(errorMessage)) summary = `${summary}\n\n${errorMessage}`;
  if (summary.includes(`Stopped after ${AGENT_TASK_MAX_TOOL_ROUNDS} tool rounds`)) {
    summary = `[capped]\n${summary}`;
  }
  return summary.length > AGENT_TASK_SUMMARY_LIMIT
    ? `${summary.slice(0, AGENT_TASK_SUMMARY_LIMIT).trimEnd()}\n\n[summary truncated]`
    : summary;
}

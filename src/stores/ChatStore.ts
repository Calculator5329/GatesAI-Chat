import { autorun, makeAutoObservable, runInAction } from 'mobx';
import type { AssistantMessage, ChatSnapshot, Message, Thread, ToolResult } from '../core/types';
import type { LlmProvider, LlmRequest, ToolCall } from '../core/llm';
import { DEFAULT_MODEL_ID } from '../core/models';
import { formatAttachmentFooter, isImageMime, toMessageAttachmentRef } from '../core/attachments';
import { loadSnapshot, saveSnapshot } from '../services/persistence';
import { computeUsage, contextWindowFor, estimateLlmPayloadTokens, type TokenUsage } from '../core/tokens';
import { flattenForWire } from '../services/llm/wireFormat';
import { resolveWireImages } from '../services/llm/resolveImages';
import { modelSupportsVision } from '../core/modelCapabilities';
import {
  buildToolResultCompactionInput,
  compactLargeToolResultsInThread,
  deterministicCompactToolResult,
} from '../services/llm/contextCompaction';
import { StreamingTextBuffer } from '../services/streaming/StreamingTextBuffer';
import { toolRegistry } from '../services/tools/registry';
import { generateThreadTitle } from '../services/threadNamer';
import { loadArtifactReadmeInstructions } from '../services/chat/artifactReadmeContext';
import { buildRuntimeContext } from '../services/chat/runtimeContext';
import { isToolFailureContent, logToolCallFailure } from '../services/chat/toolFailureLog';
import { logEvent } from '../services/diagnostics/chatLog';
import type { ProviderStore } from './ProviderStore';
import type { ModelRegistry } from './ModelRegistry';
import type { UserProfileStore } from './UserProfileStore';
import type { ToolContext } from '../services/tools/types';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Hard cap on the number of tool-call rounds per user turn, to prevent infinite loops if a model keeps re-calling the same tool. */
const MAX_TOOL_ROUNDS = 16;
const COMPACTION_TRIGGER_FRACTION = 0.9;
const COMPACTION_MAX_TOKENS = 500;
const COMPACTION_MODELS = [
  'gemini-3-flash',
  'gpt-5.4-nano',
  'gpt-5.4-mini',
  'groq-llama-3.1-8b',
  'claude-haiku-4.5',
  'or-gpt-5.4-mini',
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
  lastError: string | null = null;

  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private readonly profile: UserProfileStore;
  private readonly controllersByThread = new Map<string, AbortController>();
  private readonly textBuffer = new StreamingTextBuffer();
  private artifactInstructions = '';
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
  private toolStoresProvider: (() => Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream' | 'imageGen'>) | null = null;

  constructor(providers: ProviderStore, registry: ModelRegistry, profile: UserProfileStore) {
    this.providers = providers;
    this.registry = registry;
    this.profile = profile;
    const snapshot = loadSnapshot();
    if (snapshot) {
      this.threads = snapshot.threads;
      this.activeThreadId = snapshot.activeThreadId;
    } else {
      // First run / cleared storage: land in one empty untitled thread so the
      // user has somewhere to type. Composer is disabled by hasUsableProvider
      // until a key is configured.
      const now = Date.now();
      const id = newId('t');
      this.threads = [{
        id,
        title: 'New conversation',
        subtitle: '',
        createdAt: now,
        updatedAt: now,
        pinned: false,
        modelId: DEFAULT_MODEL_ID,
        messages: [],
      }];
      this.activeThreadId = id;
    }
    makeAutoObservable<this, 'providers' | 'registry' | 'profile' | 'controllersByThread' | 'textBuffer' | 'artifactInstructions' | 'recentSummariesProvider' | 'toolStoresProvider'>(this, {
      providers: false,
      registry: false,
      profile: false,
      controllersByThread: false,
      textBuffer: false,
      artifactInstructions: false,
      recentSummariesProvider: false,
      toolStoresProvider: false,
    });

    autorun(() => saveSnapshot(this.snapshot));
  }

  get snapshot(): ChatSnapshot {
    return { threads: this.threads, activeThreadId: this.activeThreadId };
  }

  get activeThread(): Thread | null {
    return this.threads.find(t => t.id === this.activeThreadId) ?? null;
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

  tokenUsage(draftText: string): TokenUsage {
    const thread = this.activeThread;
    const model = this.registry.findById(thread?.modelId ?? '');
    const window = contextWindowFor(model);
    if (!thread) return computeUsage(0, window);
    const latestUserText = latestUserMessageContent(thread);
    const extras = this.toolStoresProvider?.();
    const bridge = extras?.bridge;
    const toolsAllowed = model?.supportsTools !== false;
    const tools = toolsAllowed
      ? toolRegistry.toolDefsForTurn({
          userText: [latestUserText, draftText].filter(Boolean).join('\n'),
          bridgeOnline: bridge?.isOnline ?? false,
        })
      : [];
    const systemPrompt = this.profile.composeSystemPrompt({
      runtimeContext: buildRuntimeContext({ bridge }),
      threadContext: thread.threadContext,
      recentSummaries: this.recentSummariesProvider?.() ?? [],
    });
    const pendingMessages = draftText.trim()
      ? [...thread.messages, {
          id: 'draft',
          role: 'user' as const,
          content: draftText,
          createdAt: Date.now(),
        }]
      : thread.messages;
    const used = estimateLlmPayloadTokens({
      systemPrompt,
      messages: flattenForWire(pendingMessages),
      tools,
    });
    return computeUsage(used, window);
  }

  selectThread(id: string): void {
    if (this.activeThreadId === id) return;
    this.activeThreadId = id;
  }

  createThread(): string {
    const now = Date.now();
    const thread: Thread = {
      id: newId('t'),
      title: 'New conversation',
      subtitle: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      modelId: DEFAULT_MODEL_ID,
      messages: [],
    };
    this.threads.unshift(thread);
    this.activeThreadId = thread.id;
    return thread.id;
  }

  setThreadModel(threadId: string, modelId: string): void {
    const thread = this.findThread(threadId);
    if (thread) thread.modelId = modelId;
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
  setToolStoresProvider(fn: () => Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream' | 'imageGen'>): void {
    this.toolStoresProvider = fn;
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

  /**
   * Per-thread context appended to the system prompt under "About this
   * conversation:". Persists with the thread snapshot. No editor UI yet.
   */
  setThreadContext(threadId: string, context: string): void {
    const thread = this.findThread(threadId);
    if (thread) thread.threadContext = context;
  }

  /**
   * Rename a thread. Used by the `thread` tool and any future inline-rename
   * UI. No-op if the id is unknown.
   */
  renameThread(threadId: string, title: string): void {
    const thread = this.findThread(threadId);
    if (!thread) return;
    const next = title.trim();
    thread.title = next || 'Untitled conversation';
  }

  clearAllThreads(): void {
    for (const controller of this.controllersByThread.values()) controller.abort();
    this.controllersByThread.clear();
    this.textBuffer.cancelAll();
    this.streamingByThread = {};
    this.threads = [];
    this.activeThreadId = null;
    this.lastError = null;
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
    const thread = this.activeThread;
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
   *      doesn't linger if the model decides to call another tool)
   *   2. stream from the provider; append tokens to `content`, collect
   *      tool calls
   *   3. if no calls came back: this WAS the final round, exit
   *   4. otherwise: discard the round's prose (it was a "let me check"
   *      preamble we don't want in the final message), append the calls
   *      to `toolCalls`, execute them, append to `toolResults`, loop
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

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) return;

      let provider: LlmProvider;
      let providerModelId: string;
      try {
        const resolved = this.providers.router.resolve(thread.modelId);
        provider = resolved.provider;
        providerModelId = resolved.providerModelId;
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
      const bridge = this.toolStoresProvider?.().bridge;
      if (bridge?.isOnline) {
        await this.refreshArtifactInstructions(bridge, signal);
        if (signal.aborted) return;
      } else {
        this.artifactInstructions = '';
      }
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
      let errored = false;
      let textCharsThisRound = 0;
      let errorMessage: string | undefined;
      try {
        for await (const chunk of provider.stream(request, signal)) {
          if (chunk.type === 'text') {
            textCharsThisRound += chunk.delta.length;
            this.queueTextChunk(threadId, assistantMessage.id, chunk.delta);
          } else if (chunk.type === 'tool_call') {
            collectedCalls.push(chunk.call);
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

      // Runtime fallback: if the direct provider failed before any text or
      // tool calls landed (round 0 only — past that, partial state would
      // make a re-run unsafe), and an OpenRouter slug exists for this
      // model with an OR key configured, retry once through OR. This
      // covers expired keys, transient 5xxs, and provider-side outages.
      if (
        errored &&
        round === 0 &&
        textCharsThisRound === 0 &&
        collectedCalls.length === 0 &&
        provider.id !== 'openrouter'
      ) {
        const fb = this.providers.router.resolveOpenRouterFallback(thread.modelId);
        if (fb) {
          logEvent(thread.id, 'round.fallback', {
            from: { providerId: provider.id, providerModelId },
            to: { providerId: fb.provider.id, providerModelId: fb.providerModelId },
            reason: errorMessage,
          });
          provider = fb.provider;
          providerModelId = fb.providerModelId;
          request = { ...request, modelId: providerModelId };
          errored = false;
          errorMessage = undefined;
          try {
            for await (const chunk of provider.stream(request, signal)) {
              if (chunk.type === 'text') {
                textCharsThisRound += chunk.delta.length;
                this.queueTextChunk(threadId, assistantMessage.id, chunk.delta);
              } else if (chunk.type === 'tool_call') {
                collectedCalls.push(chunk.call);
              } else if (chunk.type === 'done') {
                logEvent(thread.id, 'round.done', { round, viaFallback: true, finishReason: chunk.finishReason, error: chunk.error });
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
            logEvent(thread.id, 'round.fallbackException', { error: (err as Error).message });
            errored = true;
            errorMessage = (err as Error).message;
          }
        }
      }

      if (errored && errorMessage) {
        this.textBuffer.flush(assistantMessage.id);
        runInAction(() => {
          this.lastError = errorMessage ?? 'unknown error';
          this.appendChunk(threadId, assistantMessage.id, `\n\n_Error: ${errorMessage}_`);
        });
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

      // Mid-turn: the model called tools. Discard any round-preamble prose
      // (e.g. "let me check that") so the final stored content is just the
      // model's closing reply. Append calls to the running list and execute.
      this.textBuffer.cancel(assistantMessage.id);
      runInAction(() => {
        const m = this.findMessage(threadId, assistantMessage.id);
        if (m && m.role === 'assistant') {
          m.content = '';
          m.toolCalls = [...(m.toolCalls ?? []), ...collectedCalls];
        }
      });

      const results = await this.executeToolCalls(collectedCalls, threadId, signal);
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
      const message = `Stopped after ${MAX_TOOL_ROUNDS} tool rounds to avoid an infinite loop. You can ask me to continue from the latest tool results.`;
      this.lastError = message;
      const m = this.findMessage(threadId, assistantMessage.id);
      if (m && m.role === 'assistant') {
        m.content = message;
        this.touchMessage(threadId, assistantMessage.id);
      }
      this.clearStreamingState(threadId);
    });
  }

  private buildTurnRequest(thread: Thread, providerModelId: string, recentSummaries: string[]): LlmRequest {
    const bridge = this.toolStoresProvider?.().bridge;
    const systemPrompt = this.profile.composeSystemPrompt({
      runtimeContext: buildRuntimeContext({ bridge }),
      threadContext: thread.threadContext,
      recentSummaries,
      artifactInstructions: this.artifactInstructions,
    });
    const model = this.registry.findById(thread.modelId);
    const toolsAllowed = model?.supportsTools !== false;
    const tools = toolsAllowed
      ? toolRegistry.toolDefsForTurn({
          userText: latestUserMessageContent(thread),
          bridgeOnline: bridge?.isOnline ?? false,
        })
      : undefined;
    return {
      modelId: providerModelId,
      messages: flattenForWire(thread.messages),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(tools ? { tools } : {}),
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

  private async refreshArtifactInstructions(bridge: NonNullable<ToolContext['bridge']>, signal: AbortSignal): Promise<void> {
    this.artifactInstructions = await loadArtifactReadmeInstructions(bridge, signal);
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
    let index = 0;
    while (index < calls.length) {
      if (signal.aborted) break;
      const call = calls[index];
      if (toolRegistry.isReadOnlyCall(call.name, call.arguments)) {
        const groupStart = index;
        const group: ToolCall[] = [];
        while (index < calls.length && toolRegistry.isReadOnlyCall(calls[index].name, calls[index].arguments)) {
          group.push(calls[index]);
          index += 1;
        }
        const groupResults = await Promise.all(group.map(call => this.executeOneToolCall(call, threadId)));
        groupResults.forEach((result, offset) => { results[groupStart + offset] = result; });
      } else {
        results[index] = await this.executeOneToolCall(call, threadId);
        index += 1;
      }
    }
    return results.filter(Boolean);
  }

  private async executeOneToolCall(call: ToolCall, threadId: string): Promise<ToolResult> {
    const extras = this.toolStoresProvider?.() ?? ({} as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream' | 'imageGen'>);
    const startedAt = Date.now();
    const { content, artifacts } = await toolRegistry.execute(call.name, call.arguments, {
      profile: this.profile,
      chat: this,
      notes: extras.notes,
      summary: extras.summary,
      bridge: extras.bridge,
      execStream: extras.execStream,
      imageGen: extras.imageGen,
      threadId,
    });
    if (isToolFailureContent(call.name, content)) {
      logToolCallFailure({
        call,
        threadId,
        content,
        startedAt,
        bridgeOnline: extras.bridge?.isOnline,
        readOnly: toolRegistry.isReadOnlyCall(call.name, call.arguments),
      });
    }
    return {
      toolCallId: call.id,
      toolName: call.name,
      content,
      ranAt: Date.now(),
      ...(artifacts && artifacts.length ? { artifacts } : {}),
    };
  }

  private findThread(id: string): Thread | undefined {
    return this.threads.find(t => t.id === id);
  }

  private findMessage(threadId: string, messageId: string): Message | undefined {
    return this.findThread(threadId)?.messages.find(m => m.id === messageId);
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

function latestUserMessageContent(thread: Thread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return message.content;
  }
  return '';
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

function formatOversizedContextMessage(used: number, window: number): string {
  return [
    `This thread is too large to send safely (${formatTokens(used)} of ${formatTokens(window)} tokens estimated).`,
    'Large tool results are still in the conversation context. Compact the thread, start a fresh thread, or reference the generated artifact paths instead of re-reading full files.',
  ].join('\n\n');
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

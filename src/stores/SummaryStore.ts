// Owns observable SummaryStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, runInAction } from 'mobx';
import type { LlmRequest, ProviderId } from '../core/llm';
import type { Thread } from '../core/types';
import type { ChatStore } from './ChatStore';
import type { ProviderStore } from './ProviderStore';
import type { ModelRegistry } from './ModelRegistry';

/**
 * Cross-thread memory by way of lazy summarization.
 *
 * The product principle (mirrors what ChatGPT appears to do): every other
 * thread's one-sentence summary lands in the system prompt under "Recent
 * conversations:" so the model has cross-chat awareness without paying the
 * latency or token cost of full retrieval over message history. The active
 * thread itself is never summarized while it's live — its full transcript
 * is already in context.
 *
 * Trigger policy:
 *   - the thread has ≥ MIN_MESSAGES (skip 1-message stubs)
 *   - it's not the currently-active thread
 *   - either the summary is missing OR ≥ MIN_NEW_MESSAGES new messages
 *     have arrived since `summaryMessageCount`
 *   - it's been ≥ IDLE_DEBOUNCE_MS since the user did anything on the
 *     active thread (keeps the summarizer off the hot path)
 *
 * One summary is generated at a time; queued candidates are processed in
 * `updatedAt`-descending order so the most-recently-touched threads update
 * first. If the cheap-fast model isn't configured we fall back to the
 * thread's own model — better stale-but-present than nothing.
 */

const MIN_MESSAGES = 4;
const MIN_NEW_MESSAGES = 4;
const IDLE_DEBOUNCE_MS = 60_000;
const SCAN_INTERVAL_MS = 15_000;
const MAX_SUMMARY_TOKENS = 120;

/**
 * Order matters: cheapest / fastest first. The first provider that's
 * `ready()` wins. Falls through to the thread's own model if none.
 */
const FAST_SUMMARY_MODELS: string[] = [
  'or-gemini-3.1-flash-lite',
  'or-gemini-3-flash',
];

const SUMMARY_INSTRUCTION =
  'Summarize the conversation below in ONE concise sentence (≤ 25 words), past-tense, third-person. Capture the main topic and any concrete decisions, preferences, or facts that would help a future conversation pick up context. No preamble, no quotes, no markdown — just the sentence.';

export class SummaryStore {
  /** Most recent error from the summarizer; null when healthy. Surfaced in dev tools, not the UI. */
  lastError: string | null = null;
  /** Thread id currently being summarized, or null. Prevents overlapping work. */
  inFlight: string | null = null;

  private readonly chat: ChatStore;
  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Last time the user touched the active thread (sent a message, switched
   * threads). The scheduler waits IDLE_DEBOUNCE_MS past this before kicking
   * a new summary, so summaries don't compete with the user's typing turn.
   */
  private lastActivityAt = Date.now();

  constructor(chat: ChatStore, providers: ProviderStore, registry: ModelRegistry) {
    this.chat = chat;
    this.providers = providers;
    this.registry = registry;
    makeAutoObservable<this, 'chat' | 'providers' | 'registry' | 'timer' | 'lastActivityAt'>(this, {
      chat: false, providers: false, registry: false, timer: false, lastActivityAt: false,
    });

    // Bump the activity clock whenever the active thread or its message
    // count changes — both are signals of user motion. A pure side-effect
    // observer; no state mutation depends on it.
    autorun(() => {
      void this.chat.activeThreadId;
      void this.chat.activeThread?.messages.length;
      this.lastActivityAt = Date.now();
    });
  }

  /** Boot the periodic scanner. Idempotent; only the first call wires the timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, SCAN_INTERVAL_MS);
  }

  /** For tests + teardown — stops the timer so the suite can exit cleanly. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /**
   * Snapshot of recent thread digests, newest-first, capped. Excludes the
   * given thread id (typically the active one). The list `ChatStore` injects
   * into every system prompt under "Recent conversations:".
   */
  recentSummariesExcluding(excludeId: string | null, limit = 15): string[] {
    return this.chat.threads
      .filter(t => t.id !== excludeId && !!t.summary?.trim())
      .sort((a, b) => (b.summaryUpdatedAt ?? 0) - (a.summaryUpdatedAt ?? 0))
      .slice(0, limit)
      .map(t => `${t.title}: ${t.summary!.trim()}`);
  }

  /**
   * Force-summarize a specific thread right now, ignoring the scheduler's
   * idle / freshness / active-thread filters. Used by the `thread` tool so
   * the model can refresh its own digest on demand. No-op if the thread
   * doesn't exist or another summary is already in flight.
   */
  async summarizeNow(threadId: string): Promise<boolean> {
    if (this.inFlight) return false;
    const thread = this.chat.threads.find(t => t.id === threadId);
    if (!thread) return false;
    runInAction(() => { this.inFlight = thread.id; this.lastError = null; });
    try {
      await this.summarizeOne(thread);
      return true;
    } catch (err) {
      runInAction(() => { this.lastError = (err as Error).message; });
      return false;
    } finally {
      runInAction(() => { this.inFlight = null; });
    }
  }

  /**
   * One pass of the scheduler. Picks the highest-priority candidate and
   * runs a single summary. Public so tests can drive it without waiting on
   * the interval.
   */
  async tick(): Promise<void> {
    if (this.inFlight) return;
    if (this.chat.isStreaming) return;       // back off while the model is busy
    if (Date.now() - this.lastActivityAt < IDLE_DEBOUNCE_MS) return;

    const candidate = this.pickCandidate();
    if (!candidate) return;

    runInAction(() => { this.inFlight = candidate.id; this.lastError = null; });
    try {
      await this.summarizeOne(candidate);
    } catch (err) {
      runInAction(() => { this.lastError = (err as Error).message; });
    } finally {
      runInAction(() => { this.inFlight = null; });
    }
  }

  /**
   * Pick the most-deserving thread to summarize, or null. Most-recently-
   * touched wins among threads that meet the freshness threshold so the
   * user sees their newest threads materialize summaries first.
   */
  private pickCandidate(): Thread | null {
    const activeId = this.chat.activeThreadId;
    const eligible = this.chat.threads.filter(t => {
      if (t.id === activeId) return false;
      if (t.messages.length < MIN_MESSAGES) return false;
      const since = t.summaryMessageCount ?? 0;
      const newCount = t.messages.length - since;
      const noSummary = !t.summary?.trim();
      return noSummary || newCount >= MIN_NEW_MESSAGES;
    });
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => b.updatedAt - a.updatedAt);
    return eligible[0];
  }

  private async summarizeOne(thread: Thread): Promise<void> {
    const { provider, providerModelId } = this.pickSummarizer(thread.modelId);
    if (!provider) {
      // Nothing connected at all — quietly skip.
      return;
    }

    const transcript = renderTranscript(thread);
    const request: LlmRequest = {
      modelId: providerModelId,
      systemPrompt: SUMMARY_INSTRUCTION,
      messages: [{ role: 'user', content: transcript }],
      maxTokens: MAX_SUMMARY_TOKENS,
      temperature: 0.3,
    };

    const controller = new AbortController();
    let acc = '';
    let errored = false;
    try {
      for await (const chunk of provider.stream(request, controller.signal)) {
        if (chunk.type === 'text') acc += chunk.delta;
        else if (chunk.type === 'done') {
          if (chunk.finishReason === 'error') errored = true;
          break;
        }
      }
    } catch {
      errored = true;
    }

    const cleaned = postProcess(acc);
    if (errored || !cleaned) return;

    runInAction(() => {
      const live = this.chat.threads.find(t => t.id === thread.id);
      if (!live) return;
      live.summary = cleaned;
      live.summaryUpdatedAt = Date.now();
      live.summaryMessageCount = live.messages.length;
    });
  }

  /**
   * Pick the cheap/fast provider, or fall back to the thread's own model.
   * Returns `provider: null` only when nothing is configured (no key for
   * any candidate AND the thread's own model is also unconfigured), in
   * which case the caller should silently skip.
   */
  private pickSummarizer(threadModelId: string): { provider: ReturnType<ProviderStore['router']['get']> | null; providerModelId: string } {
    for (const id of FAST_SUMMARY_MODELS) {
      const model = this.registry.findById(id);
      if (!model) continue;
      const provider = this.providers.router.get(model.providerId as ProviderId);
      if (provider.ready()) return { provider, providerModelId: model.providerModelId };
    }
    // Fallback: thread's own model.
    const fallback = this.registry.findById(threadModelId);
    if (!fallback) return { provider: null, providerModelId: '' };
    const provider = this.providers.router.get(fallback.providerId as ProviderId);
    return provider.ready()
      ? { provider, providerModelId: fallback.providerModelId }
      : { provider: null, providerModelId: '' };
  }
}

/**
 * Render a thread for the summarizer. Tool messages are flattened into
 * `[tool: name → result]` lines so the summary can mention "saved a
 * memory about X" if relevant. Capped at the last ~30 messages to keep
 * the summary call cheap on long threads.
 */
function renderTranscript(thread: Thread): string {
  const tail = thread.messages.slice(-30);
  const lines: string[] = [];
  for (const m of tail) {
    if (m.role === 'assistant') {
      const text = oneLine(m.content);
      lines.push(`Assistant: ${text}`.trim());
      // Tool activity is appended on its own indented lines so the model
      // can mention "saved a memory about X" without confusing it for
      // assistant prose.
      for (const r of m.toolResults ?? []) {
        lines.push(`  [tool ${r.toolName} → ${oneLine(r.content)}]`);
      }
    } else {
      lines.push(`User: ${oneLine(m.content)}`);
    }
  }
  return `Thread title: ${thread.title}\n\n${lines.join('\n')}`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip surrounding quotes / markdown the model occasionally adds despite instructions. */
function postProcess(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
  s = s.replace(/^Summary:\s*/i, '').trim();
  // Cap length defensively in case maxTokens didn't bind the model.
  if (s.length > 400) s = s.slice(0, 397) + '…';
  return s;
}

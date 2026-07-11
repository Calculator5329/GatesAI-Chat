// Persists or coordinates service-level state for persistence.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import type { ActivityItem, ChatSnapshot, Message, MessageAttachmentRef, ToolResult, Thread, UserMessage } from '../core/types';
import type { LlmUsage, ToolCall } from '../core/llm';
import { DEFAULT_MODEL_ID, MODELS } from '../core/models';
import { browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from './storage/persistenceProvider';
import { logger } from './diagnostics/logger';
import {
  CURRENT_CHAT_SCHEMA_VERSION,
  migrateRawChatSnapshot,
} from './persistence/migrations';
import {
  createIndexedDbThreadArchiveStore,
  type ThreadArchiveStore,
} from './persistence/idb';

const STORAGE_KEY = 'gatesai.state.v1';
const CORRUPT_STORAGE_KEY_PREFIX = `${STORAGE_KEY}.corrupt`;
const FUTURE_STORAGE_KEY_PREFIX = 'gatesai.state.backup';
export const CHAT_SNAPSHOT_STORAGE_KEY = STORAGE_KEY;
export const HOT_THREAD_LIMIT = 20;
export const PROACTIVE_HOT_THREAD_LIMIT = Math.max(1, Math.floor(HOT_THREAD_LIMIT / 2));
export const PROACTIVE_SNAPSHOT_CHARS = 3_500_000;

export type CompactionNoticeHandler = (message: string) => void;

let compactionNoticeHandler: CompactionNoticeHandler | null = null;
let defaultThreadArchiveStore: ThreadArchiveStore | null = null;
let threadArchiveStoreForTests: ThreadArchiveStore | null | undefined;
let idbUnavailableLogged = false;
let proactiveQuotaLogged = false;
let saveGeneration = 0;

/**
 * Surface a user-visible composer notice when emergency compaction succeeds.
 * Chat saves log to `persistence` either way; profile/notes/ui-prefs saves in
 * `createJsonPersistenceProvider` are log-only (no banner).
 */
export function setCompactionNoticeHandler(handler: CompactionNoticeHandler | null): void {
  compactionNoticeHandler = handler;
}

export function setThreadArchiveStoreForTests(store: ThreadArchiveStore | null | undefined): void {
  threadArchiveStoreForTests = store;
  idbUnavailableLogged = false;
  proactiveQuotaLogged = false;
}
const EMERGENCY_TOOL_RESULT_CHARS = 600;
const EMERGENCY_TOOL_ARGUMENT_CHARS = 600;
const LARGE_TOOL_ARGUMENT_KEYS = new Set(['body', 'content', 'stdin']);
const SUPPORTED_MODEL_IDS = new Set(MODELS.map(model => model.id));
const DYNAMIC_MODEL_PREFIXES = ['or-live-', 'ollama-'];
let snapshotLoadError: string | null = null;

export type ChatSnapshotPersistenceProvider = PersistenceProvider<ChatSnapshot | null>;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function createLocalChatSnapshotPersistenceProvider(
  storage: KeyValuePersistence = browserLocalStorage(),
): ChatSnapshotPersistenceProvider {
  return {
    load(): ChatSnapshot | null {
      snapshotLoadError = null;
      let raw: string | null = null;
      try {
        raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = parseChatSnapshotJson(storage, raw);
        if (!parsed.ok) return null;
        return parsed.value;
      } catch (err) {
        if (raw) {
          const reason = `Saved chat state was unreadable: ${(err as Error).message}`;
          logger.warn('persistence', 'quarantined unreadable chat snapshot', { reason });
          quarantineUnreadableSnapshot(storage, raw, reason);
        }
        return null;
      }
    },
    save(snapshot: ChatSnapshot | null): void {
      if (!snapshot) {
        this.clear();
        return;
      }
      saveCleanedSnapshot(storage, cleanSnapshot(snapshot));
    },
    clear(): void {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (err) {
        logger.warn('persistence', 'Chat snapshot clear failed', { err });
      }
    },
  };
}

export const chatSnapshotPersistence = createLocalChatSnapshotPersistenceProvider();

export function loadSnapshot(): ChatSnapshot | null {
  return chatSnapshotPersistence.load();
}

export function consumeSnapshotLoadError(): string | null {
  const message = snapshotLoadError;
  snapshotLoadError = null;
  return message;
}

export function saveSnapshot(snapshot: ChatSnapshot): void {
  chatSnapshotPersistence.save(snapshot);
}

/**
 * Deferred snapshot save — wraps `saveSnapshot` in a microtask so the
 * JSON.stringify + localStorage.setItem cost doesn't block the caller (e.g.
 * the streaming-token autorun that triggered the save). Ordering is
 * preserved by reading the LATEST queued snapshot at flush time, not the one
 * captured when the call was scheduled. If save A is queued, the store
 * mutates again, and save B is queued before the microtask fires, only B's
 * snapshot is written — A is not stale-written on top of B.
 */
let pendingDeferredSnap: ChatSnapshot | null = null;
let deferredScheduled = false;

export function scheduleSaveSnapshot(snapshot: ChatSnapshot): void {
  pendingDeferredSnap = snapshot;
  if (deferredScheduled) return;
  deferredScheduled = true;
  queueMicrotask(() => {
    deferredScheduled = false;
    const snap = pendingDeferredSnap;
    pendingDeferredSnap = null;
    if (snap) saveSnapshot(snap);
  });
}

/**
 * Drop any queued (not-yet-written) deferred snapshot. Called by `ChatStore`
 * when it pauses saving after a cross-tab write, so a microtask scheduled just
 * before the pause cannot still clobber the other tab's data.
 */
export function cancelPendingDeferredSnapshot(): void {
  pendingDeferredSnap = null;
}

/** Synchronously flush any pending deferred save. Call from unload handlers. */
export function flushPendingSnapshot(): void {
  const snap = pendingDeferredSnap;
  pendingDeferredSnap = null;
  if (snap) saveSnapshot(snap);
}

function cleanSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  // Strip transient flags (e.g. `naming`, an in-flight UI marker) so we
  // don't persist a half-named state. Stable fields like `autoNamed`
  // are preserved.
  return {
    ...snapshot,
    schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
    threads: snapshot.threads.map(t => {
      const copy = { ...t };
      delete (copy as { naming?: boolean }).naming;
      return copy;
    }),
  };
}

function saveCleanedSnapshot(storage: KeyValuePersistence, cleaned: ChatSnapshot): void {
  const generation = ++saveGeneration;
  const serialized = JSON.stringify(cleaned);
  const proactive = serialized.length > PROACTIVE_SNAPSHOT_CHARS;
  const shouldArchive = countFullThreads(cleaned) > (proactive ? PROACTIVE_HOT_THREAD_LIMIT : HOT_THREAD_LIMIT);

  if (!shouldArchive) {
    writeSnapshotToLocalStorage(storage, cleaned, serialized);
    return;
  }

  if (proactive && !proactiveQuotaLogged) {
    proactiveQuotaLogged = true;
    logger.warn('persistence', 'chat snapshot exceeded proactive archive threshold; using smaller hot tier', {
      chars: serialized.length,
      threshold: PROACTIVE_SNAPSHOT_CHARS,
      hotThreadLimit: PROACTIVE_HOT_THREAD_LIMIT,
    });
  }

  if (!proactive) {
    writeSnapshotToLocalStorage(storage, cleaned, serialized);
  }

  const hotLimit = proactive ? PROACTIVE_HOT_THREAD_LIMIT : HOT_THREAD_LIMIT;
  const archiveSave = saveTieredSnapshot(storage, cleaned, hotLimit, generation);
  trackArchiveSave(archiveSave);
}

async function saveTieredSnapshot(
  storage: KeyValuePersistence,
  snapshot: ChatSnapshot,
  hotLimit: number,
  generation: number,
): Promise<void> {
  const tiered = await prepareSnapshotForArchiveTier(snapshot, hotLimit);
  if (generation !== saveGeneration) return;
  writeSnapshotToLocalStorage(storage, tiered);
}

async function prepareSnapshotForArchiveTier(snapshot: ChatSnapshot, hotLimit: number): Promise<ChatSnapshot> {
  const hotIds = new Set(
    [...snapshot.threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, hotLimit)
      .map(thread => thread.id),
  );
  const nextThreads: Thread[] = [];

  for (const thread of snapshot.threads) {
    if (thread.archived || hotIds.has(thread.id)) {
      nextThreads.push(thread.archived ? createArchivedThreadStub(thread) : createHotThread(thread));
      continue;
    }

    const store = getThreadArchiveStore();
    if (!store) {
      logIdbUnavailable('Thread archive store is disabled.');
      nextThreads.push(thread);
      continue;
    }

    try {
      await store.putThread(createArchiveThread(thread));
      nextThreads.push(createArchivedThreadStub(thread));
    } catch (err) {
      logIdbUnavailable('IndexedDB thread archive write failed; keeping thread in localStorage.', err);
      nextThreads.push(thread);
    }
  }

  return { ...snapshot, threads: nextThreads };
}

function writeSnapshotToLocalStorage(storage: KeyValuePersistence, snapshot: ChatSnapshot, serialized?: string): void {
  try {
    storage.setItem(STORAGE_KEY, serialized ?? JSON.stringify(snapshot));
  } catch (err) {
    logger.warn('persistence', 'localStorage rejected full chat snapshot; attempting compaction', err);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(compactSnapshotForEmergencySave(snapshot)));
      logger.warn('persistence', 'saved compacted chat snapshot after localStorage rejected full snapshot');
      compactionNoticeHandler?.(
        'Chat history was compacted to fit browser storage limits. Some tool output was shortened.',
      );
    } catch (err) {
      logger.error('persistence', 'failed to save chat snapshot', err);
      compactionNoticeHandler?.(
        'Chat history could not be saved — browser storage is full. Recent changes may be lost if you reload. Free up space or clear old data.',
      );
    }
  }
}

function countFullThreads(snapshot: ChatSnapshot): number {
  return snapshot.threads.filter(thread => !thread.archived).length;
}

function createArchiveThread(thread: Thread): Thread {
  const copy = JSON.parse(JSON.stringify({
    ...thread,
  })) as Thread;
  delete (copy as { naming?: boolean }).naming;
  delete copy.archived;
  return copy;
}

function createHotThread(thread: Thread): Thread {
  const copy = { ...thread };
  delete copy.archived;
  return copy;
}

function createArchivedThreadStub(thread: Thread): Thread {
  const stub: Thread = {
    id: thread.id,
    title: thread.title,
    subtitle: thread.subtitle,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned,
    modelId: thread.modelId,
    messages: [],
    archived: true,
  };
  if (thread.contextMode) stub.contextMode = thread.contextMode;
  if (thread.thinkingEffort) stub.thinkingEffort = thread.thinkingEffort;
  if (thread.skillId !== undefined) stub.skillId = thread.skillId;
  if (thread.agentTask !== undefined) stub.agentTask = thread.agentTask;
  if (thread.agentTaskOriginThreadId !== undefined) stub.agentTaskOriginThreadId = thread.agentTaskOriginThreadId;
  if (thread.agentTaskStatus !== undefined) stub.agentTaskStatus = thread.agentTaskStatus;
  if (thread.agentTaskScheduledStartAt !== undefined) stub.agentTaskScheduledStartAt = thread.agentTaskScheduledStartAt;
  if (thread.agentTaskSystemPrompt !== undefined) stub.agentTaskSystemPrompt = thread.agentTaskSystemPrompt;
  if (thread.agentTaskMaxRounds !== undefined) stub.agentTaskMaxRounds = thread.agentTaskMaxRounds;
  if (thread.deletedAt !== undefined) stub.deletedAt = thread.deletedAt;
  if (thread.threadContext !== undefined) stub.threadContext = thread.threadContext;
  if (thread.summary !== undefined) stub.summary = thread.summary;
  if (thread.summaryUpdatedAt !== undefined) stub.summaryUpdatedAt = thread.summaryUpdatedAt;
  if (thread.summaryMessageCount !== undefined) stub.summaryMessageCount = thread.summaryMessageCount;
  if (thread.autoNamed !== undefined) stub.autoNamed = thread.autoNamed;
  return stub;
}

function getThreadArchiveStore(): ThreadArchiveStore | null {
  if (threadArchiveStoreForTests !== undefined) return threadArchiveStoreForTests;
  defaultThreadArchiveStore ??= createIndexedDbThreadArchiveStore();
  return defaultThreadArchiveStore;
}

function logIdbUnavailable(message: string, err?: unknown): void {
  if (idbUnavailableLogged) return;
  idbUnavailableLogged = true;
  logger.warn('persistence', message, err);
}

const pendingArchiveSaves = new Set<Promise<void>>();

function trackArchiveSave(promise: Promise<void>): void {
  pendingArchiveSaves.add(promise);
  void promise
    .finally(() => pendingArchiveSaves.delete(promise))
    .catch(() => undefined);
}

export async function flushThreadArchiveSavesForTests(): Promise<void> {
  while (pendingArchiveSaves.size > 0) {
    await Promise.allSettled([...pendingArchiveSaves]);
  }
}

export async function loadArchivedThread(threadId: string): Promise<Thread | null> {
  const store = getThreadArchiveStore();
  if (!store) {
    logIdbUnavailable('Thread archive store is disabled.');
    return null;
  }
  try {
    const thread = await store.getThread(threadId);
    if (!thread) return null;
    const hydrated = { ...thread };
    delete hydrated.archived;
    return hydrated;
  } catch (err) {
    logIdbUnavailable('IndexedDB thread archive read failed.', err);
    return null;
  }
}

function quarantineUnreadableSnapshot(storage: KeyValuePersistence, raw: string, reason: string): void {
  snapshotLoadError = `${reason} A recovery copy was saved in localStorage.`;
  try {
    storage.setItem(`${CORRUPT_STORAGE_KEY_PREFIX}-${Date.now()}`, raw);
  } catch (err) {
    logger.error('persistence', 'failed to save corrupt chat snapshot recovery copy', err);
    snapshotLoadError = `${reason} A recovery copy could not be saved: ${(err as Error).message}`;
  }
}

function backupFutureSnapshot(storage: KeyValuePersistence, raw: string, version: number): void {
  const reason = `Saved chat state uses schema version ${version}, which this version of GatesAI cannot read.`;
  snapshotLoadError = `${reason} A backup copy was saved and GatesAI started with a fresh chat.`;
  try {
    storage.setItem(`${FUTURE_STORAGE_KEY_PREFIX}.${Date.now()}`, raw);
  } catch (err) {
    logger.error('persistence', 'failed to save future chat snapshot backup copy', err);
    snapshotLoadError = `${reason} A backup copy could not be saved: ${(err as Error).message}`;
  }
}

export function prepareChatSnapshotForSave(snapshot: ChatSnapshot): ChatSnapshot {
  return cleanSnapshot(snapshot);
}

function parseChatSnapshotJson(storage: KeyValuePersistence, raw: string): ParseResult<ChatSnapshot> {
  const decoded = JSON.parse(raw) as unknown;
  const migrated = migrateRawChatSnapshot(decoded);
  if (!migrated.ok) {
    logger.warn('persistence', 'found newer chat snapshot schema; preserving backup and starting fresh', {
      schemaVersion: migrated.version,
    });
    backupFutureSnapshot(storage, raw, migrated.version);
    return { ok: false, reason: 'Saved chat state was created by a newer version of GatesAI.' };
  }
  const parsed = parseChatSnapshotShape(migrated.value);
  if (!parsed.ok) {
    logger.warn('persistence', 'quarantined corrupt chat snapshot', { reason: parsed.reason });
    quarantineUnreadableSnapshot(storage, raw, parsed.reason);
    return parsed;
  }
  return { ok: true, value: migrateParsedSnapshot(parsed.value) };
}

export function parseChatSnapshotValue(value: unknown): ChatSnapshot | null {
  try {
    const migrated = migrateRawChatSnapshot(value);
    if (!migrated.ok) return null;
    const parsed = parseChatSnapshotShape(migrated.value);
    if (!parsed.ok) return null;
    return migrateParsedSnapshot(parsed.value);
  } catch {
    return null;
  }
}

function compactSnapshotForEmergencySave(snapshot: ChatSnapshot): ChatSnapshot {
  return {
    ...snapshot,
    threads: snapshot.threads.map(thread => ({
      ...thread,
      messages: thread.messages.map(compactMessageForEmergencySave),
    })),
  };
}

function compactMessageForEmergencySave(message: Message): Message {
  if (message.role !== 'assistant') return message;
  return {
    ...message,
    toolCalls: message.toolCalls?.map(compactToolCallForEmergencySave),
    toolResults: message.toolResults?.map(result => ({
      ...result,
      content: compactToolResult(result),
    })),
  };
}

function compactToolCallForEmergencySave(call: ToolCall): ToolCall {
  return {
    ...call,
    arguments: compactToolArguments(call),
  };
}

function compactToolArguments(call: ToolCall): Record<string, unknown> {
  const path = typeof call.arguments.path === 'string' ? call.arguments.path : '';
  return Object.fromEntries(Object.entries(call.arguments).map(([key, value]) => {
    if (!LARGE_TOOL_ARGUMENT_KEYS.has(key) || typeof value !== 'string') return [key, value];
    return [key, compactLargeString({
      marker: 'persisted tool argument compacted',
      value,
      maxChars: EMERGENCY_TOOL_ARGUMENT_CHARS,
      metadata: [
        `original_chars: ${value.length}`,
        `tool: ${call.name}`,
        `argument: ${key}`,
        path ? `path: ${path}` : '',
      ].filter(Boolean),
    })];
  }));
}

function compactToolResult(result: ToolResult): string {
  return compactLargeString({
    marker: 'persisted tool result compacted',
    value: result.content,
    maxChars: EMERGENCY_TOOL_RESULT_CHARS,
    metadata: [
      `original_chars: ${result.content.length}`,
      `tool: ${result.toolName}`,
    ],
  });
}

function compactLargeString(opts: {
  marker: string;
  value: string;
  maxChars: number;
  metadata: string[];
}): string {
  if (opts.value.length <= opts.maxChars) return opts.value;
  const edgeChars = Math.floor(opts.maxChars / 2);
  const head = opts.value.slice(0, edgeChars);
  const tail = opts.value.slice(-edgeChars);
  return [
    `[${opts.marker}]`,
    [...opts.metadata, `omitted_chars: ${opts.value.length - (edgeChars * 2)}`].join('; '),
    head,
    '...',
    tail,
  ].join('\n');
}

/**
 * Forward-migrate any snapshot shape we've ever shipped. Two layered
 * migrations, run in order:
 *
 *   1. Fold legacy `role: 'tool'` messages onto the preceding assistant
 *      message's `toolResults`. (We dropped the `tool` role entirely.)
 *
 *   2. Fold consecutive assistant messages from the same turn into ONE.
 *      (We used to store one assistant message per round trip; we now
 *      store one per user turn, with all calls/results accumulated and
 *      the final round's prose kept as `content`.)
 *
 * Both are idempotent — clean snapshots round-trip unchanged.
 */
function migrateParsedSnapshot(snap: ChatSnapshot): ChatSnapshot {
  const threads: Thread[] = snap.threads.map(t => ({
    ...t,
    modelId: isSupportedModelId(t.modelId) ? t.modelId : DEFAULT_MODEL_ID,
    messages: foldAssistantRuns(foldToolMessages(t.messages as LegacyMessage[])),
  }));
  return { ...snap, threads };
}

function parseChatSnapshotShape(value: unknown): ParseResult<ChatSnapshot> {
  if (!isRecord(value)) return { ok: false, reason: 'Saved chat state had an invalid shape.' };
  if (!Array.isArray(value.threads)) return { ok: false, reason: 'Saved chat state had an invalid thread list.' };
  const rawThreadCount = value.threads.length;
  const threads = value.threads
    .map(parseThread)
    .filter((thread): thread is Thread => thread !== null);
  if (threads.length < rawThreadCount) {
    logger.warn('persistence', 'Dropped invalid threads during chat load', {
      droppedCount: rawThreadCount - threads.length,
      keptCount: threads.length,
    });
  }
  const activeThreadId = typeof value.activeThreadId === 'string' || value.activeThreadId === null
    ? value.activeThreadId
    : null;
  return {
    ok: true,
    value: {
      schemaVersion: numberField(value.schemaVersion) ?? CURRENT_CHAT_SCHEMA_VERSION,
      threads,
      activeThreadId,
    },
  };
}

function parseThread(value: unknown): Thread | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const title = stringField(value.title);
  const archived = booleanField(value.archived) ?? false;
  const messages = Array.isArray(value.messages)
    ? value.messages.map(parseLegacyMessage).filter((message): message is LegacyMessage => message !== null)
    : archived
      ? []
      : null;
  if (!id || !title || !messages) return null;
  const thread: Thread = {
    id,
    title,
    subtitle: stringField(value.subtitle) ?? '',
    createdAt: numberField(value.createdAt) ?? Date.now(),
    updatedAt: numberField(value.updatedAt) ?? Date.now(),
    pinned: booleanField(value.pinned) ?? false,
    readOnly: booleanField(value.readOnly),
    modelId: stringField(value.modelId) ?? DEFAULT_MODEL_ID,
    messages: messages as Message[],
    contextMode: parseContextMode(value.contextMode),
    thinkingEffort: parseThinkingEffort(value.thinkingEffort),
    skillId: parseSkillId(value.skillId),
    agentTask: booleanField(value.agentTask),
    agentTaskOriginThreadId: stringField(value.agentTaskOriginThreadId),
    agentTaskStatus: parseAgentTaskStatus(value.agentTaskStatus),
    agentTaskScheduledStartAt: numberField(value.agentTaskScheduledStartAt),
    agentTaskSystemPrompt: stringField(value.agentTaskSystemPrompt),
    agentTaskMaxRounds: numberField(value.agentTaskMaxRounds),
    deletedAt: numberField(value.deletedAt),
    threadContext: stringField(value.threadContext),
    summary: stringField(value.summary),
    summaryUpdatedAt: numberField(value.summaryUpdatedAt),
    summaryMessageCount: numberField(value.summaryMessageCount),
    autoNamed: booleanField(value.autoNamed),
  };
  if (archived) thread.archived = true;
  return thread;
}

function parseLegacyMessage(value: unknown): LegacyMessage | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const content = stringField(value.content);
  const createdAt = numberField(value.createdAt);
  if (!id || content === undefined || createdAt === undefined) return null;
  if (value.role === 'user') {
    return {
      id,
      role: 'user',
      content,
      createdAt,
      attachments: parseAttachments(value.attachments),
    };
  }
  if (value.role === 'assistant') {
    return {
      id,
      role: 'assistant',
      content,
      createdAt,
      model: stringField(value.model),
      preTokenLabel: parsePreTokenLabel(value.preTokenLabel),
      workNotes: parseStringArray(value.workNotes),
      toolCalls: parseToolCalls(value.toolCalls),
      toolResults: parseToolResults(value.toolResults),
      usage: parseLlmUsageArray(value.usage),
      finishReason: parseFinishReason(value.finishReason),
      activityEvents: parseActivityItems(value.activityEvents),
    };
  }
  if (value.role === 'tool') {
    const toolCallId = stringField(value.toolCallId);
    const toolName = stringField(value.toolName);
    if (!toolCallId || !toolName) return null;
    return { id, role: 'tool', content, createdAt, toolCallId, toolName };
  }
  return null;
}

function parseAttachments(value: unknown): UserMessage['attachments'] {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map(item => {
      if (!isRecord(item)) return null;
      const path = stringField(item.path);
      const name = stringField(item.name);
      const mime = stringField(item.mime);
      const size = numberField(item.size);
      return path && name && mime && size !== undefined ? { path, name, mime, size } : null;
    })
    .filter((item): item is MessageAttachmentRef => item !== null);
  return attachments.length ? attachments : undefined;
}

function parseToolCalls(value: unknown): ToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls = value
    .map((item): ToolCall | null => {
      if (!isRecord(item) || !isRecord(item.arguments)) return null;
      const id = stringField(item.id);
      const name = stringField(item.name);
      if (!id || !name) return null;
      const call: ToolCall = {
        id,
        name,
        arguments: item.arguments,
      };
      const argumentsError = stringField(item.argumentsError);
      const rawArguments = stringField(item.rawArguments);
      if (argumentsError !== undefined) call.argumentsError = argumentsError;
      if (rawArguments !== undefined) call.rawArguments = rawArguments;
      return call;
    })
    .filter((item): item is ToolCall => item !== null);
  return calls.length ? calls : undefined;
}

function parseToolResults(value: unknown): ToolResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results = value
    .map((item): ToolResult | null => {
      if (!isRecord(item)) return null;
      const toolCallId = stringField(item.toolCallId);
      const toolName = stringField(item.toolName);
      const content = stringField(item.content);
      const ranAt = numberField(item.ranAt);
      if (!toolCallId || !toolName || content === undefined || ranAt === undefined) return null;
      const result: ToolResult = {
        toolCallId,
        toolName,
        content,
        ranAt,
      };
      const summary = stringField(item.summary);
      const ok = booleanField(item.ok);
      const errorCode = stringField(item.errorCode);
      const retryable = booleanField(item.retryable);
      const durationMs = numberField(item.durationMs);
      const outputChars = numberField(item.outputChars);
      if (summary !== undefined) result.summary = summary;
      if (ok !== undefined) result.ok = ok;
      if (errorCode !== undefined) result.errorCode = errorCode;
      if (retryable !== undefined) result.retryable = retryable;
      if (durationMs !== undefined) result.durationMs = durationMs;
      if (outputChars !== undefined) result.outputChars = outputChars;
      return result;
    })
    .filter((item): item is ToolResult => item !== null);
  return results.length ? results : undefined;
}

function parseLlmUsageArray(value: unknown): LlmUsage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const usage = value
    .map(parseLlmUsage)
    .filter((item): item is LlmUsage => item !== null);
  return usage.length ? usage : undefined;
}

function parseLlmUsage(value: unknown): LlmUsage | null {
  if (!isRecord(value)) return null;
  const usage: LlmUsage = {};
  const providerId = parseProviderId(value.providerId);
  const modelId = stringField(value.modelId);
  const promptTokens = numberField(value.promptTokens);
  const completionTokens = numberField(value.completionTokens);
  const totalTokens = numberField(value.totalTokens);
  const costUsd = numberField(value.costUsd);
  const costSource = parseCostSource(value.costSource);
  if (providerId !== undefined) usage.providerId = providerId;
  if (modelId !== undefined) usage.modelId = modelId;
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (costUsd !== undefined) usage.costUsd = costUsd;
  if (costSource !== undefined) usage.costSource = costSource;
  return Object.keys(usage).length > 0 ? usage : null;
}

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function parseContextMode(value: unknown): Thread['contextMode'] {
  return value === 'full' || value === 'system-tools' || value === 'bare' || value === 'micro' ? value : undefined;
}

function parseThinkingEffort(value: unknown): Thread['thinkingEffort'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function parseSkillId(value: unknown): Thread['skillId'] {
  return typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : undefined;
}

function parsePreTokenLabel(value: unknown) {
  return value === 'thinking' || value === 'responding' || value === 'compacting' || value === 'generating' ? value : undefined;
}

function parseFinishReason(value: unknown) {
  return value === 'stop' || value === 'length' || value === 'tool_use' || value === 'cancelled' || value === 'content_filter' || value === 'error' ? value : undefined;
}

function parseAgentTaskStatus(value: unknown): Thread['agentTaskStatus'] {
  return value === 'scheduled' || value === 'running' || value === 'done' || value === 'error' || value === 'interrupted' ? value : undefined;
}

function parseActivityItems(value: unknown): ActivityItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events = value
    .map((item): ActivityItem | null => {
      if (!isRecord(item)) return null;
      const id = stringField(item.id);
      const kind = parseActivityKind(item.kind);
      const state = parseActivityState(item.state);
      const verb = stringField(item.verb);
      const startedAt = numberField(item.startedAt);
      if (!id || !kind || !state || !verb || startedAt === undefined) return null;
      const event: ActivityItem = {
        id,
        kind,
        state,
        verb,
        startedAt,
      };
      const target = stringField(item.target);
      const summary = stringField(item.summary);
      const detail = parseActivityDetail(item.detail);
      const finishedAt = numberField(item.finishedAt);
      const toolCallId = stringField(item.toolCallId);
      const groupKey = stringField(item.groupKey);
      const linkThreadId = stringField(item.linkThreadId);
      if (target !== undefined) event.target = target;
      if (summary !== undefined) event.summary = summary;
      if (detail !== undefined) event.detail = detail;
      if (finishedAt !== undefined) event.finishedAt = finishedAt;
      if (toolCallId !== undefined) event.toolCallId = toolCallId;
      if (groupKey !== undefined) event.groupKey = groupKey;
      if (linkThreadId !== undefined) event.linkThreadId = linkThreadId;
      return event;
    })
    .filter((item): item is ActivityItem => item !== null);
  return events.length ? events : undefined;
}

function parseActivityKind(value: unknown) {
  return value === 'thinking' || value === 'tool' || value === 'image-job' || value === 'exec-tail' || value === 'bridge' || value === 'agent-task'
    ? value
    : undefined;
}

function parseActivityState(value: unknown) {
  return value === 'running' || value === 'done' || value === 'failed' || value === 'cancelled' ? value : undefined;
}

function parseActivityDetail(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (value.type === 'markdown') {
    const content = stringField(value.content);
    const placeholder = stringField(value.placeholder);
    return content !== undefined || placeholder !== undefined
      ? { type: 'markdown' as const, content, placeholder }
      : undefined;
  }
  if (value.type === 'terminal') {
    const lines = Array.isArray(value.lines)
      ? value.lines.map(line => {
          if (!isRecord(line)) return null;
          const stream = line.stream === 'stderr' ? 'stderr' : line.stream === 'stdout' ? 'stdout' : null;
          const text = stringField(line.text);
          return stream && text !== undefined ? { stream, text } : null;
        }).filter((line): line is { stream: 'stdout' | 'stderr'; text: string } => line !== null)
      : undefined;
    const placeholder = stringField(value.placeholder);
    return lines || placeholder !== undefined ? { type: 'terminal' as const, lines, placeholder } : undefined;
  }
  return undefined;
}

function parseProviderId(value: unknown): LlmUsage['providerId'] {
  return value === 'openrouter' || value === 'ollama' || value === 'local-image' ? value : undefined;
}

function parseCostSource(value: unknown): LlmUsage['costSource'] {
  return value === 'provider' || value === 'pricing' || value === 'free' || value === 'local' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isSupportedModelId(modelId: string): boolean {
  return SUPPORTED_MODEL_IDS.has(modelId)
    || DYNAMIC_MODEL_PREFIXES.some(prefix => modelId.startsWith(prefix));
}

/** Pre-migration message — `role: 'tool'` was a third union member. */
type LegacyMessage =
  | Message
  | {
      id: string;
      role: 'tool';
      content: string;
      createdAt: number;
      toolCallId: string;
      toolName: string;
    };

function foldToolMessages(messages: LegacyMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const lastAssistant = findLastAssistant(out);
      if (lastAssistant) {
        const result: ToolResult = {
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          content: m.content,
          ranAt: m.createdAt,
        };
        lastAssistant.toolResults = [...(lastAssistant.toolResults ?? []), result];
      }
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Collapse runs of consecutive assistant messages (same turn, multiple
 * rounds) into a single assistant message. The merged message keeps the
 * first round's id/createdAt/model (so external references stay stable),
 * concatenates `toolCalls` and `toolResults` in order across the run, and
 * uses the LAST non-empty `content` as the final prose — that's the
 * model's closing reply, which is what the user actually wants to see.
 */
function foldAssistantRuns(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (m.role === 'assistant' && prev?.role === 'assistant') {
      prev.toolCalls = [...(prev.toolCalls ?? []), ...(m.toolCalls ?? [])];
      prev.toolResults = [...(prev.toolResults ?? []), ...(m.toolResults ?? [])];
      if (prev.usage || m.usage) prev.usage = [...(prev.usage ?? []), ...(m.usage ?? [])];
      if (m.content.trim().length > 0) prev.content = m.content;
      continue;
    }
    out.push(m);
  }
  return out;
}

function findLastAssistant(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') return m;
  }
  return null;
}

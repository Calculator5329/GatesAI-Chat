// Persists or coordinates service-level state for persistence.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import type { ChatSnapshot, Message, MessageAttachmentRef, ToolResult, Thread, UserMessage } from '../core/types';
import type { ToolCall } from '../core/llm';
import { DEFAULT_MODEL_ID, MODELS } from '../core/models';
import { browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from './storage/persistenceProvider';

const STORAGE_KEY = 'gatesai.state.v1';
const CORRUPT_STORAGE_KEY_PREFIX = `${STORAGE_KEY}.corrupt`;
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
        const parsed = parseChatSnapshotShape(JSON.parse(raw));
        if (!parsed.ok) {
          quarantineUnreadableSnapshot(storage, raw, parsed.reason);
          return null;
        }
        return migrate(parsed.value);
      } catch (err) {
        if (raw) {
          quarantineUnreadableSnapshot(storage, raw, `Saved chat state was unreadable: ${(err as Error).message}`);
        }
        return null;
      }
    },
    save(snapshot: ChatSnapshot | null): void {
      if (!snapshot) {
        this.clear();
        return;
      }
      const cleaned = cleanSnapshot(snapshot);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      } catch {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(compactSnapshotForEmergencySave(cleaned)));
          console.warn('[persistence] saved compacted chat snapshot after localStorage rejected full snapshot');
        } catch (err) {
          console.error('[persistence] failed to save chat snapshot', err);
        }
      }
    },
    clear(): void {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
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
    threads: snapshot.threads.map(t => {
      const copy = { ...t };
      delete (copy as { naming?: boolean }).naming;
      return copy;
    }),
  };
}

function quarantineUnreadableSnapshot(storage: KeyValuePersistence, raw: string, reason: string): void {
  snapshotLoadError = `${reason} A recovery copy was saved in localStorage.`;
  try {
    storage.setItem(`${CORRUPT_STORAGE_KEY_PREFIX}-${Date.now()}`, raw);
  } catch (err) {
    snapshotLoadError = `${reason} A recovery copy could not be saved: ${(err as Error).message}`;
  }
}

export function prepareChatSnapshotForSave(snapshot: ChatSnapshot): ChatSnapshot {
  return cleanSnapshot(snapshot);
}

export function parseChatSnapshotValue(value: unknown): ChatSnapshot | null {
  try {
    const parsed = parseChatSnapshotShape(value);
    if (!parsed.ok) return null;
    return migrate(parsed.value);
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
function migrate(snap: ChatSnapshot): ChatSnapshot {
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
  const threads = value.threads
    .map(parseThread)
    .filter((thread): thread is Thread => thread !== null);
  const activeThreadId = typeof value.activeThreadId === 'string' || value.activeThreadId === null
    ? value.activeThreadId
    : null;
  return { ok: true, value: { threads, activeThreadId } };
}

function parseThread(value: unknown): Thread | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const title = stringField(value.title);
  const messages = Array.isArray(value.messages)
    ? value.messages.map(parseLegacyMessage).filter((message): message is LegacyMessage => message !== null)
    : null;
  if (!id || !title || !messages) return null;
  return {
    id,
    title,
    subtitle: stringField(value.subtitle) ?? '',
    createdAt: numberField(value.createdAt) ?? Date.now(),
    updatedAt: numberField(value.updatedAt) ?? Date.now(),
    pinned: booleanField(value.pinned) ?? false,
    modelId: stringField(value.modelId) ?? DEFAULT_MODEL_ID,
    messages: messages as Message[],
    contextMode: parseContextMode(value.contextMode),
    deletedAt: numberField(value.deletedAt),
    threadContext: stringField(value.threadContext),
    summary: stringField(value.summary),
    summaryUpdatedAt: numberField(value.summaryUpdatedAt),
    summaryMessageCount: numberField(value.summaryMessageCount),
    autoNamed: booleanField(value.autoNamed),
  };
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
      usage: Array.isArray(value.usage) ? value.usage.filter(isRecord) : undefined,
      finishReason: parseFinishReason(value.finishReason),
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

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function parseContextMode(value: unknown): Thread['contextMode'] {
  return value === 'full' || value === 'system-tools' || value === 'bare' || value === 'micro' ? value : undefined;
}

function parsePreTokenLabel(value: unknown) {
  return value === 'thinking' || value === 'responding' || value === 'compacting' || value === 'generating' ? value : undefined;
}

function parseFinishReason(value: unknown) {
  return value === 'stop' || value === 'length' || value === 'tool_use' || value === 'cancelled' || value === 'content_filter' || value === 'error' ? value : undefined;
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

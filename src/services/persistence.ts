import type { ChatSnapshot, Message, ToolResult, Thread } from '../core/types';
import type { ToolCall } from '../core/llm';
import { DEFAULT_MODEL_ID, MODELS } from '../core/models';
import { browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from './storage/persistenceProvider';

const STORAGE_KEY = 'gatesai.state.v1';
const EMERGENCY_TOOL_RESULT_CHARS = 600;
const EMERGENCY_TOOL_ARGUMENT_CHARS = 600;
const LARGE_TOOL_ARGUMENT_KEYS = new Set(['body', 'content', 'stdin']);
const SUPPORTED_MODEL_IDS = new Set(MODELS.map(model => model.id));
const DYNAMIC_MODEL_PREFIXES = ['or-live-', 'ollama-'];

export type ChatSnapshotPersistenceProvider = PersistenceProvider<ChatSnapshot | null>;

export function createLocalChatSnapshotPersistenceProvider(
  storage: KeyValuePersistence = browserLocalStorage(),
): ChatSnapshotPersistenceProvider {
  return {
    load(): ChatSnapshot | null {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ChatSnapshot;
        if (!parsed || !Array.isArray(parsed.threads)) return null;
        return migrate(parsed);
      } catch {
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

export function saveSnapshot(snapshot: ChatSnapshot): void {
  chatSnapshotPersistence.save(snapshot);
}

export function saveSnapshotToLocalStorage(snapshot: ChatSnapshot): void {
  const cleaned = cleanSnapshot(snapshot);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // Emergency-save fallback only runs when the primary write fails (typically
    // QuotaExceededError). It compacts large tool results / arguments to fit
    // under the storage cap. Swallowed errors here are terminal — nothing more
    // we can do.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactSnapshotForEmergencySave(cleaned)));
      console.warn('[persistence] saved compacted chat snapshot after localStorage rejected full snapshot');
    } catch (err) {
      console.error('[persistence] failed to save chat snapshot', err);
    }
  }
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

export function prepareChatSnapshotForSave(snapshot: ChatSnapshot): ChatSnapshot {
  return cleanSnapshot(snapshot);
}

export function parseChatSnapshotValue(value: unknown): ChatSnapshot | null {
  try {
    const parsed = value as ChatSnapshot;
    if (!parsed || !Array.isArray(parsed.threads)) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function parseChatSnapshotRaw(raw: string): ChatSnapshot | null {
  try {
    return parseChatSnapshotValue(JSON.parse(raw));
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

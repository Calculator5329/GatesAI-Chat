// Persistence adapter: conversations as versioned JSON records in a
// key-value store.
//
// The `KeyValueStore` port is the only storage concept in the spike; a real
// build supplies IndexedDB on the desktop, localStorage in Web Lite, or the
// bridge's filesystem. Schema version and migration live here, inside the
// adapter, so the domain never sees a `schemaVersion` field. In v4 the
// schema version reaches `ChatStore` itself
// (`CURRENT_CHAT_SCHEMA_VERSION` is imported by the store).

import type { Conversation, ConversationId, Message } from '../domain/model';
import type { ConversationRepository } from '../domain/ports';

export const CURRENT_SCHEMA_VERSION = 2;

export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export class MapKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();
  private writes = 0;

  constructor(seed?: Readonly<Record<string, string>>) {
    for (const [key, value] of Object.entries(seed ?? {})) this.entries.set(key, value);
  }

  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.entries.set(key, value);
  }

  /** Test/inspection affordances; not part of the port. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }

  get writeCount(): number {
    return this.writes;
  }
}

export interface KeyValueRepositoryOptions {
  readonly store: KeyValueStore;
  readonly namespace?: string;
  /** Surfaced instead of thrown: a corrupt record must not brick the app. */
  readonly onCorruptRecord?: (key: string, raw: string, reason: string) => void;
}

export class KeyValueConversationRepository implements ConversationRepository {
  private readonly store: KeyValueStore;
  private readonly namespace: string;
  private readonly onCorruptRecord: (key: string, raw: string, reason: string) => void;

  constructor(options: KeyValueRepositoryOptions) {
    this.store = options.store;
    this.namespace = options.namespace ?? 'spike-v5.conversation';
    this.onCorruptRecord = options.onCorruptRecord ?? (() => {});
  }

  async load(id: ConversationId): Promise<Conversation | undefined> {
    const key = this.key(id);
    const raw = await this.store.get(key);
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.onCorruptRecord(key, raw, 'not-json');
      return undefined;
    }
    const record = migrate(parsed);
    if (!record) {
      this.onCorruptRecord(key, raw, 'unreadable-record');
      return undefined;
    }
    return record;
  }

  async save(conversation: Conversation): Promise<void> {
    await this.store.set(
      this.key(conversation.id),
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, conversation }),
    );
  }

  private key(id: ConversationId): string {
    return `${this.namespace}.${id}`;
  }
}

/** In-memory repository, for tests and for a `--no-persist` runtime. */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();

  constructor(seed: readonly Conversation[] = []) {
    for (const conversation of seed) this.byId.set(conversation.id, conversation);
  }

  async load(id: ConversationId): Promise<Conversation | undefined> {
    return this.byId.get(id);
  }

  async save(conversation: Conversation): Promise<void> {
    this.byId.set(conversation.id, conversation);
  }
}

/**
 * v1 records stored `messages[].content`; v2 stores `messages[].text` and a
 * `kind` discriminant. The migration is the adapter's whole job on read.
 */
function migrate(parsed: unknown): Conversation | undefined {
  if (!isRecord(parsed)) return undefined;
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) return undefined;
  const body = parsed.conversation;
  if (!isRecord(body)) return undefined;

  const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
  const messages: Message[] = [];
  for (const item of messagesRaw) {
    const message = version < 2 ? migrateMessageV1(item) : readMessage(item);
    if (!message) return undefined;
    messages.push(message);
  }

  if (typeof body.id !== 'string' || typeof body.modelId !== 'string') return undefined;
  return {
    id: body.id as ConversationId,
    title: typeof body.title === 'string' ? body.title : 'New conversation',
    modelId: body.modelId,
    systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : '',
    messages,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
  };
}

function migrateMessageV1(item: unknown): Message | undefined {
  if (!isRecord(item)) return undefined;
  const role = item.role;
  if (role !== 'user' && role !== 'assistant') return undefined;
  const text = typeof item.content === 'string' ? item.content : '';
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return undefined;
  const createdAt = typeof item.createdAt === 'number' ? item.createdAt : 0;
  if (role === 'user') {
    return { kind: 'user', id: id as Message['id'], role, text, createdAt };
  }
  return {
    kind: 'assistant',
    id: id as Message['id'],
    role,
    text,
    createdAt,
    modelId: typeof item.modelId === 'string' ? item.modelId : 'unknown',
    stoppedAt: createdAt,
    stopReason: 'complete',
  };
}

function readMessage(item: unknown): Message | undefined {
  if (!isRecord(item)) return undefined;
  if (item.kind !== 'user' && item.kind !== 'assistant') return undefined;
  if (typeof item.id !== 'string' || typeof item.text !== 'string') return undefined;
  return item as unknown as Message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

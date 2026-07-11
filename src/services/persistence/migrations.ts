// Ordered raw snapshot migrations for chat persistence.
// Called before shape parsing so legacy values can be normalized without
// teaching every parser branch about every historical spelling.

export const CURRENT_CHAT_SCHEMA_VERSION = 3;

export interface RawChatSnapshotMigration {
  from: number;
  to: number;
  migrate(snapshot: unknown): unknown;
}

export type RawChatSnapshotMigrationResult =
  | { ok: true; value: unknown; fromVersion: number; toVersion: number }
  | { ok: false; reason: 'future-version'; version: number };

export const chatSnapshotMigrations: RawChatSnapshotMigration[] = [
  {
    from: 1,
    to: 2,
    migrate: migrateThinkingEffortAliases,
  },
  {
    from: 2,
    to: 3,
    migrate: migrateMessagesToContentParts,
  },
];

export function migrateRawChatSnapshot(value: unknown): RawChatSnapshotMigrationResult {
  const fromVersion = readSchemaVersion(value);
  if (fromVersion > CURRENT_CHAT_SCHEMA_VERSION) {
    return { ok: false, reason: 'future-version', version: fromVersion };
  }

  let currentVersion = fromVersion;
  let currentValue = value;
  while (currentVersion < CURRENT_CHAT_SCHEMA_VERSION) {
    const migration = chatSnapshotMigrations.find(item => item.from === currentVersion);
    if (!migration) break;
    currentValue = migration.migrate(currentValue);
    currentVersion = migration.to;
  }

  return {
    ok: true,
    value: ensureSchemaVersion(currentValue, currentVersion),
    fromVersion,
    toVersion: currentVersion,
  };
}

function migrateThinkingEffortAliases(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return snapshot;
  const threads = Array.isArray(snapshot.threads)
    ? snapshot.threads.map(thread => {
      if (!isRecord(thread)) return thread;
      const thinkingEffort = normalizeThinkingEffortAlias(thread.thinkingEffort);
      return {
        ...thread,
        ...(thinkingEffort === undefined ? {} : { thinkingEffort }),
      };
    })
    : snapshot.threads;
  return {
    ...snapshot,
    schemaVersion: 2,
    ...(Array.isArray(snapshot.threads) ? { threads } : {}),
  };
}

function migrateMessagesToContentParts(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return snapshot;
  const threads = Array.isArray(snapshot.threads)
    ? snapshot.threads.map(thread => {
      if (!isRecord(thread) || !Array.isArray(thread.messages)) return thread;
      return { ...thread, messages: thread.messages.map(migrateMessageToContentParts) };
    })
    : snapshot.threads;
  return {
    ...snapshot,
    schemaVersion: 3,
    ...(Array.isArray(snapshot.threads) ? { threads } : {}),
  };
}

function migrateMessageToContentParts(value: unknown): unknown {
  if (!isRecord(value) || Array.isArray(value.parts) || value.role === 'tool') return value;
  if (value.role === 'user') {
    const attachments = Array.isArray(value.attachments) ? value.attachments : [];
    const parts = [
      ...(typeof value.content === 'string' && value.content ? [{ type: 'text', text: value.content }] : []),
      ...attachments
        .filter(isRecord)
        .map(attachment => ({
          type: typeof attachment.mime === 'string' && /^image\//i.test(attachment.mime) ? 'image' : 'artifact',
          attachment,
        })),
    ];
    const { content: _content, attachments: _attachments, ...message } = value;
    return { ...message, parts };
  }
  if (value.role === 'assistant') {
    const calls = Array.isArray(value.toolCalls) ? value.toolCalls.filter(isRecord) : [];
    const results = Array.isArray(value.toolResults) ? value.toolResults.filter(isRecord) : [];
    const usedResults = new Set<number>();
    const toolParts: Array<{ type: 'tool'; call?: Record<string, unknown>; result?: Record<string, unknown> }> = calls.map(call => {
      const resultIndex = results.findIndex((result, index) =>
        !usedResults.has(index)
        && typeof call.id === 'string'
        && result.toolCallId === call.id,
      );
      if (resultIndex < 0) return { type: 'tool' as const, call };
      usedResults.add(resultIndex);
      return { type: 'tool' as const, call, result: results[resultIndex] };
    });
    results.forEach((result, index) => {
      if (!usedResults.has(index)) toolParts.push({ type: 'tool', result });
    });
    const parts = [
      ...toolParts,
      ...(typeof value.content === 'string' && value.content ? [{ type: 'text', text: value.content }] : []),
    ];
    const { content: _content, toolCalls: _toolCalls, toolResults: _toolResults, ...message } = value;
    return { ...message, parts };
  }
  return value;
}

function normalizeThinkingEffortAlias(value: unknown): unknown {
  if (value === 'none') return 'low';
  if (value === 'xhigh') return 'high';
  return value;
}

function ensureSchemaVersion(value: unknown, schemaVersion: number): unknown {
  if (!isRecord(value)) return value;
  return { ...value, schemaVersion };
}

function readSchemaVersion(value: unknown): number {
  if (!isRecord(value)) return 1;
  return typeof value.schemaVersion === 'number' && Number.isFinite(value.schemaVersion)
    ? value.schemaVersion
    : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Ordered raw snapshot migrations for chat persistence.
// Called before shape parsing so legacy values can be normalized without
// teaching every parser branch about every historical spelling.

export const CURRENT_CHAT_SCHEMA_VERSION = 2;

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

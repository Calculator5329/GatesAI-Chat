// Persists or coordinates service-level state for workspaceChatPersistence.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
// Rendering of the browsable HTML/Markdown library lives in
// services/chat/libraryExport — this module owns persistence policy only.
import type { ChatSnapshot } from '../core/types';
import type { FsReadResp } from '../core/workspace';
import {
  parseChatSnapshotValue,
  prepareChatSnapshotForSave,
} from './persistence';
import type { BridgeClientFacade } from './tools/types';
import { logger } from './diagnostics/logger';
import { saveReadableChatLibrary } from './chat/libraryExport';

export {
  WORKSPACE_CHAT_LIBRARY_DIR,
  WORKSPACE_CHAT_LIBRARY_INDEX_PATH,
} from './chat/libraryExport';

export const WORKSPACE_CHAT_DIR = '/workspace/.gatesai/chat';
export const WORKSPACE_CHAT_STATE_PATH = `${WORKSPACE_CHAT_DIR}/state.v1.json`;
const WORKSPACE_CHAT_TMP_PATH = `${WORKSPACE_CHAT_STATE_PATH}.tmp`;

export interface WorkspaceChatSnapshotEnvelope {
  version: 1;
  savedAt: string;
  snapshot: ChatSnapshot;
  source?: 'workspace' | 'localStorage-migration' | 'local-newer-than-workspace';
}

export type WorkspaceChatLoadResult =
  | { kind: 'loaded'; snapshot: ChatSnapshot; envelope: WorkspaceChatSnapshotEnvelope }
  | { kind: 'missing' }
  | { kind: 'malformed'; raw: string; error: string };

export interface WorkspaceChatPersistence {
  load(): Promise<WorkspaceChatLoadResult>;
  save(snapshot: ChatSnapshot, source?: WorkspaceChatSnapshotEnvelope['source']): Promise<void>;
  backupMalformed(raw: string): Promise<string>;
}

// Workspace persistence is intentionally bridge-backed rather than local-only:
// the chat state should travel with a project, and localStorage is only the
// migration/fallback layer managed by ChatStore.
export function createWorkspaceChatPersistence(rawClient: BridgeClientFacade): WorkspaceChatPersistence {
  // All chat-persistence ops touch the bridge's protected chat-history
  // subtrees, which deny unprivileged (tool-originated) requests. Wrap the
  // client once so every request from this module is marked privileged.
  const client: BridgeClientFacade = {
    request: (op, data, onEvent) => rawClient.request(op, data, onEvent, { privileged: true }),
  };
  return {
    async load(): Promise<WorkspaceChatLoadResult> {
      await ensureDir(client);
      let raw = '';
      try {
        const resp = await client.request<FsReadResp>('fs.read', {
          path: WORKSPACE_CHAT_STATE_PATH,
          encoding: 'utf8',
        });
        raw = resp.content;
      } catch (err) {
        if (isMissingWorkspaceStateError(err)) return { kind: 'missing' };
        throw err;
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        const envelope = parseEnvelope(parsed);
        if (!envelope) {
          logger.warn('persistence', 'Workspace chat snapshot malformed', { error: 'Invalid workspace chat snapshot envelope.' });
          return { kind: 'malformed', raw, error: 'Invalid workspace chat snapshot envelope.' };
        }
        return { kind: 'loaded', snapshot: envelope.snapshot, envelope };
      } catch (err) {
        logger.warn('persistence', 'Workspace chat snapshot malformed', { error: (err as Error).message });
        return { kind: 'malformed', raw, error: (err as Error).message };
      }
    },

    async save(snapshot: ChatSnapshot, source = 'workspace'): Promise<void> {
      await ensureDir(client);
      const savedAt = new Date().toISOString();
      const envelope: WorkspaceChatSnapshotEnvelope = {
        version: 1,
        savedAt,
        source,
        snapshot: prepareChatSnapshotForSave(snapshot),
      };
      const raw = JSON.stringify(envelope);
      await client.request('fs.write', {
        path: WORKSPACE_CHAT_TMP_PATH,
        content: raw,
        encoding: 'utf8',
      });
      try {
        await client.request('fs.move', {
          from: WORKSPACE_CHAT_TMP_PATH,
          to: WORKSPACE_CHAT_STATE_PATH,
        });
      } catch (err) {
        logger.warn('persistence', 'workspace chat atomic save fell back to direct write', err);
        await client.request('fs.write', {
          path: WORKSPACE_CHAT_STATE_PATH,
          content: raw,
          encoding: 'utf8',
        });
      }
      await saveReadableChatLibrary(client, envelope.snapshot, savedAt);
    },

    async backupMalformed(raw: string): Promise<string> {
      await ensureDir(client);
      const path = `${WORKSPACE_CHAT_DIR}/malformed-${timestampForPath()}.json`;
      await client.request('fs.write', { path, content: raw, encoding: 'utf8' });
      return path;
    },
  };
}

async function ensureDir(client: BridgeClientFacade): Promise<void> {
  await client.request('fs.mkdir', { path: WORKSPACE_CHAT_DIR });
}

function parseEnvelope(value: unknown): WorkspaceChatSnapshotEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { version?: unknown; savedAt?: unknown; snapshot?: unknown; source?: unknown };
  if (record.version !== 1 || typeof record.savedAt !== 'string') return null;
  if (
    record.source != null &&
    record.source !== 'workspace' &&
    record.source !== 'localStorage-migration' &&
    record.source !== 'local-newer-than-workspace'
  ) return null;
  const snapshot = parseChatSnapshotValue(record.snapshot);
  if (!snapshot) return null;
  return {
    version: 1,
    savedAt: record.savedAt,
    snapshot,
    ...(record.source ? { source: record.source } : {}),
  };
}

function isMissingWorkspaceStateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\b(not found|no such file|does not exist)\b/i.test(message);
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

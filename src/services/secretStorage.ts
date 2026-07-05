import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../core/runtime';
import { logger } from './diagnostics/logger';
import { browserLocalStorage, type KeyValuePersistence } from './storage/persistenceProvider';

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export const SECRET_NAMES = {
  openrouterApiKey: 'openrouter.api-key',
  openAiCompatApiKey: 'openai-compat.api-key',
  braveApiKey: 'brave.api-key',
  ollamaApiKey: 'ollama.api-key',
} as const;

export type KnownSecretName = typeof SECRET_NAMES[keyof typeof SECRET_NAMES];

export const KNOWN_SECRET_NAMES: KnownSecretName[] = [
  SECRET_NAMES.openrouterApiKey,
  SECRET_NAMES.openAiCompatApiKey,
  SECRET_NAMES.braveApiKey,
  SECRET_NAMES.ollamaApiKey,
];

export const DESKTOP_SECRET_MIGRATION_MARKER = 'gatesai.secrets.migrated.v1';

export interface SecretStorage {
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
}

export interface SecretStorageOptions {
  useTauri?: boolean;
  tauriInvoke?: TauriInvoke;
  storage?: KeyValuePersistence;
  log?: Pick<typeof logger, 'warn'>;
}

export interface SecretMigrationResult {
  ok: boolean;
  attempted: number;
  migrated: number;
  skipped: boolean;
}

interface LocalSecretMapping {
  readonly storageKey: string;
  read(storage: KeyValuePersistence): string | null;
  set(storage: KeyValuePersistence, value: string): void;
  delete(storage: KeyValuePersistence): void;
}

const SECRET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UNKNOWN_SECRET_PREFIX = 'gatesai.secret.';

const localSecretMappings: Record<KnownSecretName, LocalSecretMapping> = {
  [SECRET_NAMES.openrouterApiKey]: {
    storageKey: 'gatesai.providers.v1',
    read: readLocalOpenRouterKey,
    set: setLocalOpenRouterKey,
    delete: deleteLocalOpenRouterKey,
  },
  [SECRET_NAMES.openAiCompatApiKey]: {
    storageKey: 'gatesai.providers.v1',
    read: readLocalOpenAiCompatKey,
    set: setLocalOpenAiCompatKey,
    delete: deleteLocalOpenAiCompatKey,
  },
  [SECRET_NAMES.braveApiKey]: {
    storageKey: 'gatesai.search.v1',
    read: readLocalBraveKey,
    set: setLocalBraveKey,
    delete: deleteLocalBraveKey,
  },
  [SECRET_NAMES.ollamaApiKey]: {
    storageKey: 'gatesai.ollama.v1',
    read: readLocalOllamaKey,
    set: setLocalOllamaKey,
    delete: deleteLocalOllamaKey,
  },
};

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}

export function usesTauriSecretBackend(options: Pick<SecretStorageOptions, 'useTauri'> = {}): boolean {
  return options.useTauri ?? isTauri();
}

export function createSecretStorage(options: SecretStorageOptions = {}): SecretStorage {
  return usesTauriSecretBackend(options)
    ? createTauriSecretStorage(options.tauriInvoke ?? invoke)
    : createLocalStorageSecretStorage(options.storage ?? browserLocalStorage());
}

export async function getSecret(name: string): Promise<string | null> {
  return await createSecretStorage().getSecret(name);
}

export async function setSecret(name: string, value: string): Promise<void> {
  await createSecretStorage().setSecret(name, value);
}

export async function deleteSecret(name: string): Promise<void> {
  await createSecretStorage().deleteSecret(name);
}

export async function migrateDesktopSecretsFromLocalStorage(
  options: SecretStorageOptions = {},
): Promise<SecretMigrationResult> {
  const storage = options.storage ?? browserLocalStorage();
  const log = options.log ?? logger;
  if (!usesTauriSecretBackend(options)) {
    return { ok: true, attempted: 0, migrated: 0, skipped: true };
  }

  try {
    if (storage.getItem(DESKTOP_SECRET_MIGRATION_MARKER) === '1') {
      return { ok: true, attempted: 0, migrated: 0, skipped: true };
    }
  } catch (err) {
    log.warn('persistence', 'desktop secret migration marker read failed', { err });
    return { ok: false, attempted: 0, migrated: 0, skipped: false };
  }

  const localBackend = createLocalStorageSecretStorage(storage);
  const tauriBackend = createTauriSecretStorage(options.tauriInvoke ?? invoke);
  const pending: Array<{ name: KnownSecretName; value: string }> = [];

  try {
    for (const name of KNOWN_SECRET_NAMES) {
      const value = await localBackend.getSecret(name);
      if (value) pending.push({ name, value });
    }
  } catch (err) {
    log.warn('persistence', 'desktop secret migration localStorage scan failed', { err });
    return { ok: false, attempted: 0, migrated: 0, skipped: false };
  }

  if (pending.length === 0) {
    try {
      storage.setItem(DESKTOP_SECRET_MIGRATION_MARKER, '1');
      return { ok: true, attempted: 0, migrated: 0, skipped: false };
    } catch (err) {
      log.warn('persistence', 'desktop secret migration marker write failed', { err });
      return { ok: false, attempted: 0, migrated: 0, skipped: false };
    }
  }

  try {
    for (const item of pending) {
      await tauriBackend.setSecret(item.name, item.value);
      const verified = await tauriBackend.getSecret(item.name);
      if (verified !== item.value) {
        throw new Error(`Secret read-back verification failed for ${item.name}.`);
      }
    }
  } catch (err) {
    log.warn('persistence', 'desktop secret migration failed; keeping localStorage secrets', { err });
    return { ok: false, attempted: pending.length, migrated: 0, skipped: false };
  }

  try {
    for (const item of pending) {
      await localBackend.deleteSecret(item.name);
    }
    storage.setItem(DESKTOP_SECRET_MIGRATION_MARKER, '1');
  } catch (err) {
    log.warn('persistence', 'desktop secret migration cleanup failed after verified keychain write', { err });
    return { ok: false, attempted: pending.length, migrated: pending.length, skipped: false };
  }

  return { ok: true, attempted: pending.length, migrated: pending.length, skipped: false };
}

function createTauriSecretStorage(tauriInvoke: TauriInvoke): SecretStorage {
  return {
    async getSecret(name) {
      assertValidSecretName(name);
      return await tauriInvoke<string | null>('secret_get', { name });
    },
    async setSecret(name, value) {
      assertValidSecretName(name);
      await tauriInvoke('secret_set', { name, value });
    },
    async deleteSecret(name) {
      assertValidSecretName(name);
      await tauriInvoke('secret_delete', { name });
    },
  };
}

function createLocalStorageSecretStorage(storage: KeyValuePersistence): SecretStorage {
  return {
    async getSecret(name) {
      assertValidSecretName(name);
      const mapping = localSecretMappings[name as KnownSecretName];
      if (mapping) return mapping.read(storage);
      return storage.getItem(unknownSecretKey(name));
    },
    async setSecret(name, value) {
      assertValidSecretName(name);
      const mapping = localSecretMappings[name as KnownSecretName];
      if (mapping) mapping.set(storage, value);
      else storage.setItem(unknownSecretKey(name), value);
    },
    async deleteSecret(name) {
      assertValidSecretName(name);
      const mapping = localSecretMappings[name as KnownSecretName];
      if (mapping) mapping.delete(storage);
      else storage.removeItem(unknownSecretKey(name));
    },
  };
}

function assertValidSecretName(name: string): void {
  if (!isValidSecretName(name)) {
    throw new Error('Secret name must match ^[a-z0-9][a-z0-9._-]{0,63}$');
  }
}

function unknownSecretKey(name: string): string {
  return `${UNKNOWN_SECRET_PREFIX}${name}`;
}

function readLocalOpenRouterKey(storage: KeyValuePersistence): string | null {
  return extractOpenRouterKey(readJsonObject(storage, 'gatesai.providers.v1')) ?? null;
}

function setLocalOpenRouterKey(storage: KeyValuePersistence, value: string): void {
  const obj = readJsonObject(storage, 'gatesai.providers.v1');
  const current = objectValue(obj.openrouter ?? obj.openRouter);
  obj.openrouter = { ...current, apiKey: value };
  delete obj.openRouter;
  deleteOpenRouterLegacyKeys(obj);
  writeJsonObject(storage, 'gatesai.providers.v1', obj);
}

function deleteLocalOpenRouterKey(storage: KeyValuePersistence): void {
  const obj = readJsonObject(storage, 'gatesai.providers.v1');
  const current = objectValue(obj.openrouter ?? obj.openRouter);
  delete current.apiKey;
  delete current.key;
  if (Object.keys(current).length > 0) obj.openrouter = current;
  else delete obj.openrouter;
  delete obj.openRouter;
  deleteOpenRouterLegacyKeys(obj);
  writeJsonObject(storage, 'gatesai.providers.v1', obj);
}

function readLocalOpenAiCompatKey(storage: KeyValuePersistence): string | null {
  const obj = readJsonObject(storage, 'gatesai.providers.v1');
  const compat = objectValue(obj['openai-compat'] ?? obj.openaiCompat ?? obj.openAiCompat);
  return stringValue(compat.apiKey) ?? null;
}

function setLocalOpenAiCompatKey(storage: KeyValuePersistence, value: string): void {
  const obj = readJsonObject(storage, 'gatesai.providers.v1');
  const current = objectValue(obj['openai-compat'] ?? obj.openaiCompat ?? obj.openAiCompat);
  obj['openai-compat'] = { ...current, apiKey: value };
  delete obj.openaiCompat;
  delete obj.openAiCompat;
  writeJsonObject(storage, 'gatesai.providers.v1', obj);
}

function deleteLocalOpenAiCompatKey(storage: KeyValuePersistence): void {
  const obj = readJsonObject(storage, 'gatesai.providers.v1');
  const current = objectValue(obj['openai-compat'] ?? obj.openaiCompat ?? obj.openAiCompat);
  delete current.apiKey;
  delete current.key;
  if (Object.keys(current).length > 0) obj['openai-compat'] = current;
  else delete obj['openai-compat'];
  delete obj.openaiCompat;
  delete obj.openAiCompat;
  writeJsonObject(storage, 'gatesai.providers.v1', obj);
}

function readLocalBraveKey(storage: KeyValuePersistence): string | null {
  const obj = readJsonObject(storage, 'gatesai.search.v1');
  const brave = objectValue(obj.brave);
  return stringValue(brave.apiKey) ?? null;
}

function setLocalBraveKey(storage: KeyValuePersistence, value: string): void {
  const obj = readJsonObject(storage, 'gatesai.search.v1');
  obj.brave = { ...objectValue(obj.brave), apiKey: value };
  writeJsonObject(storage, 'gatesai.search.v1', obj);
}

function deleteLocalBraveKey(storage: KeyValuePersistence): void {
  const obj = readJsonObject(storage, 'gatesai.search.v1');
  const brave = objectValue(obj.brave);
  delete brave.apiKey;
  if (Object.keys(brave).length > 0) obj.brave = brave;
  else delete obj.brave;
  writeJsonObject(storage, 'gatesai.search.v1', obj);
}

function readLocalOllamaKey(storage: KeyValuePersistence): string | null {
  const obj = readJsonObject(storage, 'gatesai.ollama.v1');
  return stringValue(obj.apiKey) ?? null;
}

function setLocalOllamaKey(storage: KeyValuePersistence, value: string): void {
  const obj = readJsonObject(storage, 'gatesai.ollama.v1');
  obj.apiKey = value;
  writeJsonObject(storage, 'gatesai.ollama.v1', obj);
}

function deleteLocalOllamaKey(storage: KeyValuePersistence): void {
  const obj = readJsonObject(storage, 'gatesai.ollama.v1');
  delete obj.apiKey;
  writeJsonObject(storage, 'gatesai.ollama.v1', obj);
}

function readJsonObject(storage: KeyValuePersistence, key: string): Record<string, unknown> {
  const raw = storage.getItem(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return objectValue(parsed);
  } catch {
    return {};
  }
}

function writeJsonObject(storage: KeyValuePersistence, key: string, value: Record<string, unknown>): void {
  if (Object.keys(value).length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(value));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractOpenRouterKey(parsed: unknown): string | undefined {
  const obj = objectValue(parsed);
  const nested = obj.openrouter ?? obj.openRouter;
  if (typeof nested === 'string') return stringValue(nested);
  if (nested && typeof nested === 'object') {
    const nestedObj = nested as Record<string, unknown>;
    const value = nestedObj.apiKey ?? nestedObj.key;
    if (typeof value === 'string') return stringValue(value);
  }
  for (const key of ['openrouterApiKey', 'openRouterApiKey', 'openrouterKey', 'openRouterKey']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const apiKeys = obj.apiKeys;
  if (apiKeys && typeof apiKeys === 'object') {
    const value = (apiKeys as Record<string, unknown>).openrouter ?? (apiKeys as Record<string, unknown>).openRouter;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function deleteOpenRouterLegacyKeys(obj: Record<string, unknown>): void {
  delete obj.openrouterApiKey;
  delete obj.openRouterApiKey;
  delete obj.openrouterKey;
  delete obj.openRouterKey;
  const apiKeys = objectValue(obj.apiKeys);
  delete apiKeys.openrouter;
  delete apiKeys.openRouter;
  if (Object.keys(apiKeys).length > 0) obj.apiKeys = apiKeys;
  else delete obj.apiKeys;
}

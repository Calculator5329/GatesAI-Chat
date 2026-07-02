import { createJsonPersistenceProvider, browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from '../storage/persistenceProvider';
import { createSecretStorage, type SecretStorage } from '../secretStorage';

export const MCP_SERVERS_STORAGE_KEY = 'gatesai.mcp.v1';

export interface McpServerConfig {
  id: string;
  label: string;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
}

export function createMcpServerConfigsPersistence(
  storage: KeyValuePersistence = browserLocalStorage(),
): PersistenceProvider<McpServerConfig[]> {
  return createJsonPersistenceProvider({
    key: MCP_SERVERS_STORAGE_KEY,
    storage,
    parse: parseMcpServerConfigs,
  });
}

export const mcpServerConfigsPersistence = createMcpServerConfigsPersistence();

export const loadMcpServerConfigs = mcpServerConfigsPersistence.load;
export const saveMcpServerConfigs = (servers: McpServerConfig[]): void => {
  mcpServerConfigsPersistence.save(redactMcpServerHeaderValues(servers));
};

export function redactMcpServerHeaderValues(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map(server => ({
    ...server,
    headers: Object.fromEntries(Object.keys(server.headers).map(name => [name, ''])),
  }));
}

export async function hydrateMcpServerHeaderSecrets(
  servers: McpServerConfig[],
  secrets: SecretStorage = createSecretStorage(),
): Promise<McpServerConfig[]> {
  const hydrated: McpServerConfig[] = [];
  for (const server of servers) {
    const headers: Record<string, string> = {};
    for (const [name, existingValue] of Object.entries(server.headers)) {
      const secretValue = await secrets.getSecret(mcpHeaderSecretName(server.id, name));
      headers[name] = secretValue ?? existingValue;
    }
    hydrated.push({ ...server, headers });
  }
  return hydrated;
}

export async function persistMcpServerHeaderSecrets(
  servers: McpServerConfig[],
  previousSecretNames: Iterable<string> = [],
  secrets: SecretStorage = createSecretStorage(),
): Promise<Set<string>> {
  const currentSecretNames = collectMcpHeaderSecretNames(servers);
  for (const server of servers) {
    for (const [name, value] of Object.entries(server.headers)) {
      const secretName = mcpHeaderSecretName(server.id, name);
      const trimmed = value.trim();
      if (trimmed) await secrets.setSecret(secretName, trimmed);
      else await secrets.deleteSecret(secretName);
    }
  }
  for (const oldName of previousSecretNames) {
    if (!currentSecretNames.has(oldName)) await secrets.deleteSecret(oldName);
  }
  return currentSecretNames;
}

export function collectMcpHeaderSecretNames(servers: McpServerConfig[]): Set<string> {
  const names = new Set<string>();
  for (const server of servers) {
    for (const name of Object.keys(server.headers)) {
      names.add(mcpHeaderSecretName(server.id, name));
    }
  }
  return names;
}

export function mcpHeaderSecretName(serverId: string, headerName: string): string {
  const serverSegment = secretNameSegment(serverId, 'server').slice(0, 24);
  const hash = shortHash(`${serverId}\n${headerName}`);
  return `mcp.${serverSegment}.${hash}`;
}

export function parseMcpServerConfigs(raw: unknown): McpServerConfig[] {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).servers)
      ? (raw as Record<string, unknown>).servers as unknown[]
      : [];
  const seen = new Set<string>();
  const out: McpServerConfig[] = [];
  values.forEach((value, index) => {
    const server = parseMcpServerConfig(value, index);
    if (!server) return;
    const base = server.id;
    let id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    out.push({ ...server, id });
  });
  return out;
}

export function normalizeMcpHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!isHttpHeaderName(name)) continue;
    out[name] = value;
  }
  return out;
}

function parseMcpServerConfig(value: unknown, index: number): McpServerConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const url = stringValue(record.url);
  if (!url) return null;
  const label = stringValue(record.label) ?? labelFromUrl(url) ?? `MCP server ${index + 1}`;
  const id = normalizeServerId(stringValue(record.id), `${label}:${url}`, index);
  return {
    id,
    label,
    url,
    headers: normalizeMcpHeaders(recordValue(record.headers)),
    enabled: record.enabled !== false,
  };
}

function normalizeServerId(value: string | undefined, seed: string, index: number): string {
  const source = value || `mcp-${shortHash(`${seed}:${index}`)}`;
  return secretNameSegment(source, 'mcp-server').replace(/[_.]/g, '-').slice(0, 48);
}

function isHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function labelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function secretNameSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .replace(/[-_.]{2,}/g, '-');
  return normalized || fallback;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(0, 8);
}

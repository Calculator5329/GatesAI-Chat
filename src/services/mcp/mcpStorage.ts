import { createJsonPersistenceProvider, browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from '../storage/persistenceProvider';
import { createSecretStorage, type SecretStorage } from '../secretStorage';

export const MCP_SERVERS_STORAGE_KEY = 'gatesai.mcp.v1';

export type McpServerTransport = 'http' | 'stdio';

interface McpServerConfigBase {
  id: string;
  label: string;
  enabled: boolean;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  transport: 'http';
  url: string;
  headers: Record<string, string>;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig;

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
  mcpServerConfigsPersistence.save(redactMcpServerSecretValues(servers));
};

export function redactMcpServerHeaderValues(servers: McpServerConfig[]): McpServerConfig[] {
  return redactMcpServerSecretValues(servers);
}

export function redactMcpServerSecretValues(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map(server => ({
    ...server,
    ...(server.transport === 'http'
      ? { headers: Object.fromEntries(Object.keys(server.headers).map(name => [name, ''])) }
      : { env: Object.fromEntries(Object.keys(server.env).map(name => [name, ''])) }),
  }));
}

export async function hydrateMcpServerHeaderSecrets(
  servers: McpServerConfig[],
  secrets: SecretStorage = createSecretStorage(),
): Promise<McpServerConfig[]> {
  return await hydrateMcpServerSecrets(servers, secrets);
}

export async function hydrateMcpServerSecrets(
  servers: McpServerConfig[],
  secrets: SecretStorage = createSecretStorage(),
): Promise<McpServerConfig[]> {
  const hydrated: McpServerConfig[] = [];
  for (const server of servers) {
    if (server.transport === 'http') {
      const headers: Record<string, string> = {};
      for (const [name, existingValue] of Object.entries(server.headers)) {
        const secretValue = await secrets.getSecret(mcpHeaderSecretName(server.id, name));
        headers[name] = secretValue ?? existingValue;
      }
      hydrated.push({ ...server, headers });
    } else {
      const env: Record<string, string> = {};
      for (const [name, existingValue] of Object.entries(server.env)) {
        const secretValue = await secrets.getSecret(mcpEnvSecretName(server.id, name));
        env[name] = secretValue ?? existingValue;
      }
      hydrated.push({ ...server, env });
    }
  }
  return hydrated;
}

export async function persistMcpServerHeaderSecrets(
  servers: McpServerConfig[],
  previousSecretNames: Iterable<string> = [],
  secrets: SecretStorage = createSecretStorage(),
): Promise<Set<string>> {
  return await persistMcpServerSecrets(servers, previousSecretNames, secrets);
}

export async function persistMcpServerSecrets(
  servers: McpServerConfig[],
  previousSecretNames: Iterable<string> = [],
  secrets: SecretStorage = createSecretStorage(),
): Promise<Set<string>> {
  const currentSecretNames = collectMcpSecretNames(servers);
  for (const server of servers) {
    const entries = server.transport === 'http'
      ? Object.entries(server.headers).map(([name, value]) => [mcpHeaderSecretName(server.id, name), value] as const)
      : Object.entries(server.env).map(([name, value]) => [mcpEnvSecretName(server.id, name), value] as const);
    for (const [secretName, value] of entries) {
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
    if (server.transport !== 'http') continue;
    for (const name of Object.keys(server.headers)) {
      names.add(mcpHeaderSecretName(server.id, name));
    }
  }
  return names;
}

export function collectMcpSecretNames(servers: McpServerConfig[]): Set<string> {
  const names = new Set<string>();
  for (const server of servers) {
    if (server.transport === 'http') {
      for (const name of Object.keys(server.headers)) names.add(mcpHeaderSecretName(server.id, name));
    } else {
      for (const name of Object.keys(server.env)) names.add(mcpEnvSecretName(server.id, name));
    }
  }
  return names;
}

export function mcpHeaderSecretName(serverId: string, headerName: string): string {
  const serverSegment = secretNameSegment(serverId, 'server').slice(0, 24);
  const hash = shortHash(`${serverId}\n${headerName}`);
  return `mcp.${serverSegment}.${hash}`;
}

export function mcpEnvSecretName(serverId: string, envName: string): string {
  const serverSegment = secretNameSegment(serverId, 'server').slice(0, 20);
  const hash = shortHash(`${serverId}\nenv\n${envName}`);
  return `mcp.${serverSegment}.env.${hash}`;
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

export function normalizeMcpEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(env)) {
    const name = rawName.trim();
    if (!isEnvName(name)) continue;
    out[name] = rawValue.trim();
  }
  return out;
}

export interface McpStdioValidationResult {
  ok: boolean;
  message: string;
}

export function validateMcpStdioConfig(input: { command: string; args?: string[]; env?: Record<string, string> }): McpStdioValidationResult {
  const command = input.command.trim();
  if (!command) return { ok: false, message: 'Local MCP command is required.' };
  if (hasNul(command)) return { ok: false, message: 'Local MCP command cannot contain NUL bytes.' };
  const args = input.args ?? [];
  if (args.some(hasNul)) return { ok: false, message: 'Local MCP arguments cannot contain NUL bytes.' };
  const commandLeaf = command.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? command.toLowerCase();
  const firstArg = args.find(arg => arg.trim().length > 0)?.trim().toLowerCase();
  if ((commandLeaf === 'cmd' || commandLeaf === 'cmd.exe') && (firstArg === '/c' || firstArg === '/k')) {
    return { ok: false, message: 'cmd /c and cmd /k are not allowed for MCP stdio servers.' };
  }
  for (const [name, value] of Object.entries(input.env ?? {})) {
    if (!isEnvName(name)) return { ok: false, message: `Invalid environment variable name "${name}".` };
    if (hasNul(value)) return { ok: false, message: 'Environment variable values cannot contain NUL bytes.' };
  }
  return { ok: true, message: 'OK' };
}

function parseMcpServerConfig(value: unknown, index: number): McpServerConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const transport = record.transport === 'stdio' ? 'stdio' : 'http';
  if (transport === 'stdio') return parseMcpStdioServerConfig(record, index);
  return parseMcpHttpServerConfig(record, index);
}

function parseMcpHttpServerConfig(record: Record<string, unknown>, index: number): McpServerConfig | null {
  const url = stringValue(record.url);
  if (!url) return null;
  const label = stringValue(record.label) ?? labelFromUrl(url) ?? `MCP server ${index + 1}`;
  const id = normalizeServerId(stringValue(record.id), `${label}:${url}`, index);
  return {
    id,
    label,
    transport: 'http',
    url,
    headers: normalizeMcpHeaders(recordValue(record.headers)),
    enabled: record.enabled !== false,
  };
}

function parseMcpStdioServerConfig(record: Record<string, unknown>, index: number): McpServerConfig | null {
  const command = stringValue(record.command);
  if (!command) return null;
  const args = arrayOfStrings(record.args);
  const env = normalizeMcpEnv(recordValue(record.env));
  const validation = validateMcpStdioConfig({ command, args, env });
  if (!validation.ok) return null;
  const label = stringValue(record.label) ?? command.split(/[\\/]/).pop() ?? `MCP server ${index + 1}`;
  const id = normalizeServerId(stringValue(record.id), `${label}:${command}`, index);
  return {
    id,
    label,
    transport: 'stdio',
    command: command.trim(),
    args,
    env,
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

function isEnvName(value: string): boolean {
  return value.length > 0 && !value.includes('=') && !hasNul(value);
}

function hasNul(value: string): boolean {
  return value.includes('\0');
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

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string') as string[];
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

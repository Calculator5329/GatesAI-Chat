import { makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import { McpClient, McpError, type McpTool, type McpToolResult } from '../services/mcp/client';
import {
  collectMcpHeaderSecretNames,
  createMcpServerConfigsPersistence,
  hydrateMcpServerHeaderSecrets,
  normalizeMcpHeaders,
  persistMcpServerHeaderSecrets,
  redactMcpServerHeaderValues,
  type McpServerConfig,
} from '../services/mcp/mcpStorage';
import { createSecretStorage, type SecretStorage } from '../services/secretStorage';
import type { KeyValuePersistence, PersistenceProvider } from '../services/storage/persistenceProvider';
import { logger } from '../services/diagnostics/logger';

export type McpConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpConnectionStatus {
  state: McpConnectionState;
  message?: string;
  errorKind?: McpError['kind'];
  toolCount?: number;
  checkedAt?: number;
}

export interface McpConnectionTestResult {
  ok: boolean;
  status: McpConnectionStatus;
}

export interface McpConnectedServer {
  server: McpServerConfig;
  tools: McpTool[];
}

interface McpClientLike {
  readonly mcpSessionId?: string | null;
  connect(url: string, headers?: Record<string, string>): Promise<unknown>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<McpToolResult>;
}

interface McpStoreOptions {
  autoPersist?: boolean;
  storage?: KeyValuePersistence;
  secrets?: SecretStorage;
  clientFactory?: () => McpClientLike;
}

export class McpStore {
  servers: McpServerConfig[] = [];
  statuses: Record<string, McpConnectionStatus> = {};
  toolsByServer: Record<string, McpTool[]> = {};

  private readonly persistence: PersistenceProvider<McpServerConfig[]>;
  private readonly secrets: SecretStorage;
  private readonly clientFactory: () => McpClientLike;
  private readonly clients = new Map<string, McpClientLike>();
  private persistedSecretNames = new Set<string>();
  private persistenceDisposer: (() => void) | null = null;

  constructor(options: McpStoreOptions = {}) {
    this.persistence = createMcpServerConfigsPersistence(options.storage);
    this.secrets = options.secrets ?? createSecretStorage();
    this.clientFactory = options.clientFactory ?? (() => new McpClient());
    this.servers = this.persistence.load();
    this.persistedSecretNames = collectMcpHeaderSecretNames(this.servers);

    makeAutoObservable<this,
      'persistence'
      | 'secrets'
      | 'clientFactory'
      | 'clients'
      | 'persistedSecretNames'
      | 'persistenceDisposer'
    >(this, {
      persistence: false,
      secrets: false,
      clientFactory: false,
      clients: false,
      persistedSecretNames: false,
      persistenceDisposer: false,
    });

    if (options.autoPersist === true) this.startPersistence();
  }

  startPersistence(): void {
    if (this.persistenceDisposer) return;
    this.persistenceDisposer = reaction(
      () => toJS(this.servers),
      servers => {
        this.persistence.save(redactMcpServerHeaderValues(servers));
        void persistMcpServerHeaderSecrets(servers, this.persistedSecretNames, this.secrets)
          .then(names => {
            this.persistedSecretNames = names;
          })
          .catch(err => logger.warn('persistence', 'MCP header secret persistence failed', { err }));
      },
      { fireImmediately: true },
    );
  }

  dispose(): void {
    this.persistenceDisposer?.();
    this.persistenceDisposer = null;
    this.clients.clear();
  }

  async hydrateHeaderSecrets(): Promise<void> {
    const hydrated = await hydrateMcpServerHeaderSecrets(toJS(this.servers), this.secrets);
    runInAction(() => {
      this.servers = hydrated;
      this.persistedSecretNames = collectMcpHeaderSecretNames(this.servers);
    });
  }

  addServer(input: { label: string; url: string; headers?: Record<string, string>; enabled?: boolean }): string {
    const label = input.label.trim() || fallbackLabel(input.url);
    const server: McpServerConfig = {
      id: uniqueServerId(this.servers, label),
      label,
      url: input.url.trim(),
      headers: normalizeMcpHeaders(input.headers ?? {}),
      enabled: input.enabled ?? true,
    };
    this.servers.push(server);
    this.statuses[server.id] = server.enabled ? { state: 'disconnected' } : { state: 'disabled' };
    return server.id;
  }

  removeServer(id: string): void {
    this.servers = this.servers.filter(server => server.id !== id);
    this.dropConnection(id);
    delete this.statuses[id];
  }

  updateServer(id: string, patch: Partial<Pick<McpServerConfig, 'label' | 'url' | 'headers'>>): void {
    const index = this.servers.findIndex(server => server.id === id);
    if (index < 0) return;
    const current = this.servers[index];
    const next: McpServerConfig = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label.trim() || current.label } : {}),
      ...(patch.url !== undefined ? { url: patch.url.trim() } : {}),
      ...(patch.headers !== undefined ? { headers: normalizeMcpHeaders(patch.headers) } : {}),
    };
    this.servers[index] = next;
    this.dropConnection(id, next.enabled ? { state: 'disconnected' } : { state: 'disabled' });
  }

  setServerEnabled(id: string, enabled: boolean): void {
    const server = this.servers.find(item => item.id === id);
    if (!server || server.enabled === enabled) return;
    server.enabled = enabled;
    this.dropConnection(id, enabled ? { state: 'disconnected' } : { state: 'disabled' });
    if (enabled) void this.testConnection(id);
  }

  statusFor(id: string): McpConnectionStatus {
    const server = this.servers.find(item => item.id === id);
    if (!server?.enabled) return { state: 'disabled' };
    return this.statuses[id] ?? { state: 'disconnected' };
  }

  toolsForServer(id: string): McpTool[] {
    return this.toolsByServer[id] ?? [];
  }

  get connectedServers(): McpConnectedServer[] {
    return this.servers
      .filter(server => server.enabled && this.statusFor(server.id).state === 'connected')
      .map(server => ({ server, tools: this.toolsForServer(server.id) }));
  }

  async connectEnabledServers(): Promise<McpConnectionTestResult[]> {
    return await Promise.all(
      this.servers
        .filter(server => server.enabled)
        .map(server => this.testConnection(server.id)),
    );
  }

  async testConnection(id: string): Promise<McpConnectionTestResult> {
    const server = this.servers.find(item => item.id === id);
    if (!server) {
      return {
        ok: false,
        status: { state: 'error', message: 'MCP server is no longer configured.', errorKind: 'connect', checkedAt: Date.now() },
      };
    }
    if (!server.enabled) {
      const status: McpConnectionStatus = { state: 'disabled', checkedAt: Date.now() };
      runInAction(() => { this.statuses[id] = status; });
      return { ok: false, status };
    }

    runInAction(() => {
      this.statuses[id] = { state: 'connecting', checkedAt: Date.now() };
    });

    const client = this.clientFactory();
    try {
      await client.connect(server.url, server.headers);
      const tools = await client.listTools();
      const status: McpConnectionStatus = {
        state: 'connected',
        message: `${tools.length} tool${tools.length === 1 ? '' : 's'} available.`,
        toolCount: tools.length,
        checkedAt: Date.now(),
      };
      runInAction(() => {
        this.clients.set(id, client);
        this.toolsByServer[id] = tools;
        this.statuses[id] = status;
      });
      return { ok: true, status };
    } catch (err) {
      const status = statusFromError(err);
      runInAction(() => {
        this.dropConnection(id, status);
      });
      logger.warn('mcp', 'MCP connection test failed', { serverId: id, err });
      return { ok: false, status };
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new McpError('connect', 'MCP server is not connected.');
    }
    return await client.callTool(toolName, args, { signal });
  }

  private dropConnection(id: string, status?: McpConnectionStatus): void {
    this.clients.delete(id);
    delete this.toolsByServer[id];
    if (status) this.statuses[id] = status;
  }
}

export function formatMcpStatus(status: McpConnectionStatus): string {
  if (status.state === 'connected') return status.message ?? 'Connected.';
  if (status.state === 'connecting') return 'Checking...';
  if (status.state === 'disabled') return 'Disabled.';
  if (status.state === 'error') return status.message ?? 'Connection failed.';
  return 'Not connected.';
}

function statusFromError(err: unknown): McpConnectionStatus {
  if (err instanceof McpError) {
    return {
      state: 'error',
      message: err.message,
      errorKind: err.kind,
      checkedAt: Date.now(),
    };
  }
  return {
    state: 'error',
    message: (err as Error).message || 'MCP connection failed.',
    errorKind: 'connect',
    checkedAt: Date.now(),
  };
}

function fallbackLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || 'MCP server';
  } catch {
    return 'MCP server';
  }
}

function uniqueServerId(existing: McpServerConfig[], label: string): string {
  const base = `mcp-${slug(label) || 'server'}-${Date.now().toString(36)}`.slice(0, 44);
  const ids = new Set(existing.map(server => server.id));
  let id = base;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${base}-${suffix}`.slice(0, 48);
    suffix += 1;
  }
  return id;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

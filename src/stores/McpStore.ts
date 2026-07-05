import { makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import { McpClient, McpError, type McpTool, type McpToolResult } from '../services/mcp/client';
import { McpStdioTransport } from '../services/mcp/stdioTransport';
import {
  collectMcpSecretNames,
  createMcpServerConfigsPersistence,
  hydrateMcpServerSecrets,
  normalizeMcpEnv,
  normalizeMcpHeaders,
  persistMcpServerSecrets,
  redactMcpServerSecretValues,
  validateMcpStdioConfig,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
} from '../services/mcp/mcpStorage';
import { createSecretStorage, type SecretStorage } from '../services/secretStorage';
import type { KeyValuePersistence, PersistenceProvider } from '../services/storage/persistenceProvider';
import { logger } from '../services/diagnostics/logger';

export type { McpServerConfig } from '../services/mcp/mcpStorage';

export type McpConnectionState = 'disabled' | 'disconnected' | 'starting' | 'running' | 'exited' | 'error';

export interface McpConnectionStatus {
  state: McpConnectionState;
  message?: string;
  errorKind?: McpError['kind'];
  toolCount?: number;
  exitCode?: number | null;
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
  connect(url?: string, headers?: Record<string, string>): Promise<unknown>;
  disconnect?(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<McpToolResult>;
}

interface McpStoreOptions {
  autoPersist?: boolean;
  storage?: KeyValuePersistence;
  secrets?: SecretStorage;
  clientFactory?: (server?: McpServerConfig) => McpClientLike;
}

export class McpStore {
  servers: McpServerConfig[] = [];
  statuses: Record<string, McpConnectionStatus> = {};
  toolsByServer: Record<string, McpTool[]> = {};

  private readonly persistence: PersistenceProvider<McpServerConfig[]>;
  private readonly secrets: SecretStorage;
  private readonly clientFactory: (server?: McpServerConfig) => McpClientLike;
  private readonly clients = new Map<string, McpClientLike>();
  private persistedSecretNames = new Set<string>();
  private persistenceDisposer: (() => void) | null = null;

  constructor(options: McpStoreOptions = {}) {
    this.persistence = createMcpServerConfigsPersistence(options.storage);
    this.secrets = options.secrets ?? createSecretStorage();
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
    this.servers = this.persistence.load();
    this.persistedSecretNames = collectMcpSecretNames(this.servers);

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
        this.persistence.save(redactMcpServerSecretValues(servers));
        void persistMcpServerSecrets(servers, this.persistedSecretNames, this.secrets)
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
    for (const [id] of this.clients) this.dropConnection(id);
    this.clients.clear();
  }

  async hydrateHeaderSecrets(): Promise<void> {
    await this.hydrateSecrets();
  }

  async hydrateSecrets(): Promise<void> {
    const hydrated = await hydrateMcpServerSecrets(toJS(this.servers), this.secrets);
    runInAction(() => {
      this.servers = hydrated;
      this.persistedSecretNames = collectMcpSecretNames(this.servers);
    });
  }

  addServer(input: { label: string; url: string; headers?: Record<string, string>; enabled?: boolean }): string {
    const label = input.label.trim() || fallbackLabel(input.url);
    const server: McpHttpServerConfig = {
      id: uniqueServerId(this.servers, label),
      label,
      transport: 'http',
      url: input.url.trim(),
      headers: normalizeMcpHeaders(input.headers ?? {}),
      enabled: input.enabled ?? true,
    };
    this.servers.push(server);
    this.statuses[server.id] = server.enabled ? { state: 'disconnected' } : { state: 'disabled' };
    return server.id;
  }

  addStdioServer(input: { label: string; command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }): string {
    const args = input.args ?? [];
    const env = normalizeMcpEnv(input.env ?? {});
    const validation = validateMcpStdioConfig({ command: input.command, args, env });
    if (!validation.ok) throw new McpError('connect', validation.message);
    const label = input.label.trim() || fallbackStdioLabel(input.command);
    const server: McpStdioServerConfig = {
      id: uniqueServerId(this.servers, label),
      label,
      transport: 'stdio',
      command: input.command.trim(),
      args,
      env,
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

  updateServer(id: string, patch: Partial<Pick<McpHttpServerConfig, 'label' | 'url' | 'headers'> & Pick<McpStdioServerConfig, 'command' | 'args' | 'env'>>): void {
    const index = this.servers.findIndex(server => server.id === id);
    if (index < 0) return;
    const current = this.servers[index];
    let next: McpServerConfig;
    if (current.transport === 'http') {
      next = {
        ...current,
        ...(patch.label !== undefined ? { label: patch.label.trim() || current.label } : {}),
        ...(patch.url !== undefined ? { url: patch.url.trim() } : {}),
        ...(patch.headers !== undefined ? { headers: normalizeMcpHeaders(patch.headers) } : {}),
      };
    } else {
      const command = patch.command !== undefined ? patch.command.trim() : current.command;
      const args = patch.args !== undefined ? patch.args : current.args;
      const env = patch.env !== undefined ? normalizeMcpEnv(patch.env) : current.env;
      const validation = validateMcpStdioConfig({ command, args, env });
      if (!validation.ok) {
        this.statuses[id] = { state: 'error', message: validation.message, errorKind: 'connect', checkedAt: Date.now() };
        return;
      }
      next = {
        ...current,
        ...(patch.label !== undefined ? { label: patch.label.trim() || current.label } : {}),
        command,
        args,
        env,
      };
    }
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
      .filter(server => server.enabled && this.statusFor(server.id).state === 'running')
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
      this.statuses[id] = { state: 'starting', checkedAt: Date.now() };
    });

    const client = this.createClient(server);
    try {
      if (server.transport === 'http') await client.connect(server.url, server.headers);
      else await client.connect();
      const tools = await client.listTools();
      const status: McpConnectionStatus = {
        state: 'running',
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
    const client = this.clients.get(id);
    if (client?.disconnect) void client.disconnect().catch(err => logger.warn('mcp', 'MCP disconnect failed', { serverId: id, err }));
    this.clients.delete(id);
    delete this.toolsByServer[id];
    if (status) this.statuses[id] = status;
  }

  private createClient(server: McpServerConfig): McpClientLike {
    if (this.clientFactory !== defaultClientFactory) {
      const custom = this.clientFactory(server);
      if (custom) return custom;
    }
    if (server.transport === 'stdio') {
      return new McpClient({
        transport: new McpStdioTransport({
          id: server.id,
          command: server.command,
          args: server.args,
          env: server.env,
        }, {
          onToolsListChanged: () => { void this.refreshTools(server.id); },
          onExit: code => {
            runInAction(() => {
              this.dropConnection(server.id, {
                state: 'exited',
                message: `Process exited${code === null ? '' : ` with code ${code}`}.`,
                exitCode: code,
                checkedAt: Date.now(),
              });
            });
          },
        }),
      });
    }
    return new McpClient();
  }

  private async refreshTools(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (!client) return;
    try {
      const tools = await client.listTools();
      runInAction(() => {
        this.toolsByServer[id] = tools;
        this.statuses[id] = {
          state: 'running',
          message: `${tools.length} tool${tools.length === 1 ? '' : 's'} available.`,
          toolCount: tools.length,
          checkedAt: Date.now(),
        };
      });
    } catch (err) {
      const status = statusFromError(err);
      runInAction(() => this.dropConnection(id, status));
    }
  }
}

export function formatMcpStatus(status: McpConnectionStatus): string {
  if (status.state === 'running') return status.message ?? 'Running.';
  if (status.state === 'starting') return 'Starting...';
  if (status.state === 'exited') return status.message ?? 'Process exited.';
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

function fallbackStdioLabel(command: string): string {
  return command.trim().replace(/\\/g, '/').split('/').pop() || 'MCP server';
}

function defaultClientFactory(): McpClientLike {
  return new McpClient();
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

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../../core/runtime';
import {
  MCP_DEFAULT_TIMEOUT_MS,
  McpError,
  parseJsonRpcPayload,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpClientTransport,
  type McpTransportSendOptions,
} from './client';
import { validateMcpStdioConfig } from './mcpStorage';

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type TauriListen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<UnlistenFn>;

export interface McpStdioMessageEvent {
  id: string;
  line: string;
}

export interface McpStdioStderrEvent {
  id: string;
  line: string;
}

export interface McpStdioExitEvent {
  id: string;
  code: number | null;
}

export interface McpStdioTransportConfig {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpStdioTransportOptions {
  requestTimeoutMs?: number;
  invoke?: TauriInvoke;
  listen?: TauriListen;
  onToolsListChanged?: () => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

interface PendingRequest {
  resolve: (responses: JsonRpcResponse[]) => void;
  reject: (err: unknown) => void;
  timer: number;
  abortListener?: () => void;
  signal?: AbortSignal;
}

export class McpStdioTransport implements McpClientTransport {
  private readonly config: McpStdioTransportConfig;
  private readonly requestTimeoutMs: number;
  private readonly invoke: TauriInvoke;
  private readonly listen: TauriListen;
  private readonly onToolsListChanged?: () => void;
  private readonly onStderr?: (line: string) => void;
  private readonly onExit?: (code: number | null) => void;
  private readonly pending = new Map<number | string, PendingRequest>();
  private unlisten: UnlistenFn[] = [];
  private started = false;
  private exited = false;

  constructor(config: McpStdioTransportConfig, options: McpStdioTransportOptions = {}) {
    const validation = validateMcpStdioConfig(config);
    if (!validation.ok) throw new McpError('connect', validation.message);
    this.config = {
      id: config.id.trim(),
      command: config.command.trim(),
      args: [...config.args],
      env: { ...config.env },
    };
    this.requestTimeoutMs = options.requestTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    this.invoke = options.invoke ?? tauriInvoke;
    this.listen = options.listen ?? tauriListen;
    this.onToolsListChanged = options.onToolsListChanged;
    this.onStderr = options.onStderr;
    this.onExit = options.onExit;
  }

  async start(): Promise<void> {
    if (!isTauri() && this.invoke === tauriInvoke) {
      throw new McpError('connect', 'Local command MCP servers require the GatesAI desktop app.');
    }
    if (this.started) return;
    this.exited = false;
    this.unlisten = [
      await this.listen<McpStdioMessageEvent>('mcp-stdio-message', event => this.handleMessage(event.payload)),
      await this.listen<McpStdioStderrEvent>('mcp-stdio-stderr', event => this.handleStderr(event.payload)),
      await this.listen<McpStdioExitEvent>('mcp-stdio-exit', event => this.handleExit(event.payload)),
    ];
    try {
      await this.invoke('mcp_stdio_start', {
        id: this.config.id,
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      });
      this.started = true;
    } catch (err) {
      this.removeListeners();
      throw new McpError('connect', `Failed to start MCP stdio server: ${(err as Error).message ?? String(err)}`);
    }
  }

  async send(
    payload: JsonRpcRequest | JsonRpcNotification,
    options: McpTransportSendOptions,
  ): Promise<JsonRpcResponse[]> {
    if (!this.started || this.exited) throw new McpError('connect', 'MCP stdio server is not running.');
    const text = JSON.stringify(payload);
    if (!options.expectResponse || !('id' in payload)) {
      await this.invoke('mcp_stdio_send', { id: this.config.id, payload: text });
      return [];
    }

    const id = payload.id;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    return await new Promise<JsonRpcResponse[]>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError('timeout', `MCP request timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const abortListener = () => {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpError('connect', 'MCP request was cancelled.'));
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });
      this.pending.set(id, { resolve, reject, timer, abortListener, signal: options.signal });
      this.invoke('mcp_stdio_send', { id: this.config.id, payload: text }).catch(err => {
        this.clearPending(id);
        reject(new McpError('connect', `Failed to write to MCP stdio server: ${(err as Error).message ?? String(err)}`));
      });
    });
  }

  async close(): Promise<void> {
    this.rejectAll(new McpError('connect', 'MCP stdio server was stopped.'));
    this.removeListeners();
    this.started = false;
    await this.invoke('mcp_stdio_stop', { id: this.config.id });
  }

  private handleMessage(payload: McpStdioMessageEvent): void {
    if (payload.id !== this.config.id) return;
    let messages: JsonRpcResponse[];
    try {
      messages = parseJsonRpcPayload(payload.line);
    } catch {
      return;
    }
    for (const message of messages) {
      if (message.id !== undefined && message.id !== null) {
        const pending = this.pendingForId(message.id);
        if (pending) {
          this.clearPending(message.id);
          pending.resolve([message]);
        }
        continue;
      }
      const notification = message as JsonRpcNotification;
      if (notification.method === 'notifications/tools/list_changed') {
        this.onToolsListChanged?.();
      }
    }
  }

  private handleStderr(payload: McpStdioStderrEvent): void {
    if (payload.id !== this.config.id) return;
    this.onStderr?.(payload.line);
  }

  private handleExit(payload: McpStdioExitEvent): void {
    if (payload.id !== this.config.id) return;
    this.exited = true;
    this.started = false;
    const codeText = payload.code === null ? 'unknown code' : `code ${payload.code}`;
    this.rejectAll(new McpError('connect', `MCP stdio server exited with ${codeText}.`));
    this.onExit?.(payload.code);
  }

  private clearPending(id: number | string): void {
    const pending = this.pendingForId(id);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abortListener ?? (() => undefined));
    for (const key of this.keysForId(id)) this.pending.delete(key);
  }

  private pendingForId(id: number | string): PendingRequest | undefined {
    for (const key of this.keysForId(id)) {
      const pending = this.pending.get(key);
      if (pending) return pending;
    }
    return undefined;
  }

  private keysForId(id: number | string): Array<number | string> {
    if (typeof id === 'number') return [id, String(id)];
    const numeric = Number(id);
    return Number.isFinite(numeric) && String(numeric) === id ? [id, numeric] : [id];
  }

  private rejectAll(err: McpError): void {
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.abortListener ?? (() => undefined));
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  private removeListeners(): void {
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }
}

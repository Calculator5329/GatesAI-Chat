export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

const CLIENT_NAME = 'gatesai-chat';
const CLIENT_VERSION = String(import.meta.env.VITE_APP_VERSION || import.meta.env.npm_package_version || '4.0.4');

export type McpErrorKind = 'connect' | 'auth' | 'timeout' | 'protocol';

export class McpError extends Error {
  readonly kind: McpErrorKind;
  readonly status?: number;
  readonly code?: number;
  readonly data?: unknown;

  constructor(kind: McpErrorKind, message: string, details: { status?: number; code?: number; data?: unknown } = {}) {
    super(message);
    this.name = 'McpError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.data = details.data;
  }
}

export interface McpClientOptions {
  fetch?: typeof fetch;
  clientVersion?: string;
  requestTimeoutMs?: number;
  transport?: McpClientTransport;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type McpContentItem =
  | { type: 'text'; text?: string }
  | { type: 'image'; data?: string; mimeType?: string }
  | { type: 'audio'; data?: string; mimeType?: string }
  | { type: 'resource'; resource?: unknown }
  | { type: string; [key: string]: unknown };

export interface McpToolResult {
  content: McpContentItem[];
  isError?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface McpTransportSendOptions {
  expectResponse: boolean;
  includeSession?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpClientTransport {
  readonly mcpSessionId?: string | null;
  start?(): Promise<void>;
  send(payload: JsonRpcRequest | JsonRpcNotification, options: McpTransportSendOptions): Promise<JsonRpcResponse[]>;
  close?(): Promise<void>;
}

export class McpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly clientVersion: string;
  private readonly requestTimeoutMs: number;
  private transport: McpClientTransport | null;
  private nextId = 1;
  private initialized = false;

  constructor(options: McpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.clientVersion = options.clientVersion ?? CLIENT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? null;
  }

  get mcpSessionId(): string | null {
    return this.transport?.mcpSessionId ?? null;
  }

  async connect(url?: string, headers: Record<string, string> = {}): Promise<this> {
    if (!this.transport) {
      if (!url) throw new McpError('connect', 'MCP URL is required for HTTP transport.');
      this.transport = new HttpMcpTransport({
        url,
        headers,
        fetchImpl: this.fetchImpl,
        requestTimeoutMs: this.requestTimeoutMs,
      });
    }
    this.initialized = false;
    await this.transport.start?.();

    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: CLIENT_NAME,
        version: this.clientVersion,
      },
    }, { includeSession: false });

    const initializeResult = expectRecord(result, 'initialize result');
    const protocolVersion = stringValue(initializeResult.protocolVersion);
    if (protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new McpError(
        'protocol',
        `MCP server negotiated unsupported protocol version "${protocolVersion ?? 'unknown'}".`,
        { data: initializeResult },
      );
    }

    await this.notify('notifications/initialized');
    this.initialized = true;
    return this;
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    await this.transport?.close?.();
  }

  async listTools(): Promise<McpTool[]> {
    this.assertConnected();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request('tools/list', cursor ? { cursor } : undefined);
      const page = expectRecord(result, 'tools/list result');
      const rawTools = Array.isArray(page.tools) ? page.tools : [];
      for (const rawTool of rawTools) {
        const tool = parseMcpTool(rawTool);
        if (tool) tools.push(tool);
      }
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined;
    } while (cursor);
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<McpToolResult> {
    this.assertConnected();
    const result = await this.request('tools/call', {
      name,
      arguments: args,
    }, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS,
    });
    const record = expectRecord(result, 'tools/call result');
    const content = Array.isArray(record.content)
      ? record.content.map(parseContentItem)
      : [];
    return {
      content,
      ...(record.isError === true ? { isError: true } : {}),
    };
  }

  private async request(
    method: string,
    params?: unknown,
    options: { includeSession?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    const responses = await this.postJsonRpc(request, {
      expectResponse: true,
      includeSession: options.includeSession,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    const response = findResponseById(responses, id);
    if (!response) {
      throw new McpError('protocol', `MCP server did not return a JSON-RPC response for request ${id}.`);
    }
    if (response.error) {
      throw new McpError('protocol', response.error.message || 'MCP JSON-RPC error.', {
        code: response.error.code,
        data: response.error.data,
      });
    }
    return response.result;
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };
    await this.postJsonRpc(notification, {
      expectResponse: false,
      includeSession: true,
    });
  }

  private async postJsonRpc(
    payload: JsonRpcRequest | JsonRpcNotification,
    options: { expectResponse: boolean; includeSession?: boolean; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonRpcResponse[]> {
    if (!this.transport) throw new McpError('connect', 'MCP transport is not connected.');
    return await this.transport.send(payload, options);
  }

  private assertConnected(): void {
    if (!this.transport || !this.initialized) {
      throw new McpError('connect', 'MCP client is not connected.');
    }
  }
}

interface HttpMcpTransportOptions {
  url: string;
  headers: Record<string, string>;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
}

class HttpMcpTransport implements McpClientTransport {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private sessionId: string | null = null;

  constructor(options: HttpMcpTransportOptions) {
    this.endpoint = normalizeEndpoint(options.url);
    this.headers = normalizeHeaders(options.headers);
    this.fetchImpl = options.fetchImpl;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  get mcpSessionId(): string | null {
    return this.sessionId;
  }

  async send(
    payload: JsonRpcRequest | JsonRpcNotification,
    options: McpTransportSendOptions,
  ): Promise<JsonRpcResponse[]> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortListener = () => controller.abort();
    options.signal?.addEventListener('abort', abortListener, { once: true });

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: this.requestHeaders(options.includeSession !== false),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      this.captureSessionId(response);
      if (!response.ok) {
        throw await errorFromHttpResponse(response);
      }
      if (!options.expectResponse && response.status === 202) return [];
      return await readJsonRpcResponses(response, options.expectResponse);
    } catch (err) {
      if (err instanceof McpError) throw err;
      if (timedOut) throw new McpError('timeout', `MCP request timed out after ${timeoutMs}ms.`);
      if (options.signal?.aborted) throw new McpError('connect', 'MCP request was cancelled.');
      throw new McpError('connect', `MCP connection failed: ${(err as Error).message}`);
    } finally {
      window.clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortListener);
    }
  }

  private requestHeaders(includeSession: boolean): Record<string, string> {
    return {
      ...this.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(includeSession && this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    };
  }

  private captureSessionId(response: Response): void {
    const header = response.headers.get('Mcp-Session-Id');
    if (header && /^[\x21-\x7e]+$/.test(header)) this.sessionId = header;
  }
}

async function readJsonRpcResponses(response: Response, expectResponse: boolean): Promise<JsonRpcResponse[]> {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  const raw = await response.text();
  if (!raw.trim()) {
    if (!expectResponse) return [];
    throw new McpError('protocol', 'MCP server returned an empty response body.');
  }
  if (contentType.includes('text/event-stream') || raw.trimStart().startsWith('data:')) {
    return parseSseJsonRpcResponses(raw);
  }
  if (contentType.includes('application/json') || contentType === '') {
    return parseJsonRpcPayload(raw);
  }
  try {
    return parseJsonRpcPayload(raw);
  } catch {
    throw new McpError('protocol', `Unsupported MCP response content type "${contentType}".`);
  }
}

export function parseSseJsonRpcResponses(raw: string): JsonRpcResponse[] {
  const responses: JsonRpcResponse[] = [];
  const eventBlocks = raw.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of eventBlocks) {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') continue;
    responses.push(...parseJsonRpcValue(JSON.parse(data)));
  }
  return responses;
}

export function parseJsonRpcPayload(raw: string): JsonRpcResponse[] {
  try {
    return parseJsonRpcValue(JSON.parse(raw));
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError('protocol', `MCP server returned invalid JSON: ${(err as Error).message}`);
  }
}

export function parseJsonRpcValue(value: unknown): JsonRpcResponse[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new McpError('protocol', 'MCP server returned a non-object JSON-RPC message.');
    }
    return item as JsonRpcResponse;
  });
}

function findResponseById(responses: JsonRpcResponse[], id: number): JsonRpcResponse | null {
  return responses.find(response => response.id === id || response.id === String(id)) ?? null;
}

async function errorFromHttpResponse(response: Response): Promise<McpError> {
  const message = await safeHttpErrorMessage(response);
  if (response.status === 401 || response.status === 403) {
    return new McpError('auth', message || `MCP authentication failed with HTTP ${response.status}.`, { status: response.status });
  }
  if (response.status === 408 || response.status === 504) {
    return new McpError('timeout', message || `MCP request timed out with HTTP ${response.status}.`, { status: response.status });
  }
  const kind: McpErrorKind = response.status >= 500 ? 'connect' : 'protocol';
  return new McpError(kind, message || `MCP request failed with HTTP ${response.status}.`, { status: response.status });
}

async function safeHttpErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) return '';
    try {
      const parsed = JSON.parse(text) as unknown;
      const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      const error = record?.error;
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') return message;
      }
    } catch {
      // Fall through to the raw text preview.
    }
    return text.trim().slice(0, 500);
  } catch {
    return '';
  }
}

function parseMcpTool(value: unknown): McpTool | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = stringValue(record.name);
  if (!name) return null;
  const description = stringValue(record.description);
  const inputSchema = record.inputSchema && typeof record.inputSchema === 'object' && !Array.isArray(record.inputSchema)
    ? record.inputSchema as Record<string, unknown>
    : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {}),
  };
}

function parseContentItem(value: unknown): McpContentItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: 'unknown' };
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' && record.type ? record.type : 'unknown';
  return { ...record, type } as McpContentItem;
}

function normalizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new McpError('connect', 'MCP URL must use http or https.');
    }
    return parsed.toString();
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError('connect', 'MCP URL is not valid.');
  }
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.trim();
    const text = value.trim();
    if (!name || !text) continue;
    out[name] = text;
  }
  return out;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError('protocol', `MCP ${label} was not an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

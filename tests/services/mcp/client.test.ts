import { describe, expect, it, vi } from 'vitest';
import { McpClient, McpError, parseSseJsonRpcResponses } from '../../../src/services/mcp/client';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

function accepted(): Response {
  return new Response('', { status: 202 });
}

describe('McpClient', () => {
  it('runs initialize, initialized notification, and paged tools/list', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: Record<string, unknown> };
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock', version: '1.0.0' },
          },
        }, { headers: { 'Mcp-Session-Id': 'session-123' } });
      }
      if (body.method === 'notifications/initialized') return accepted();
      if (body.method === 'tools/list' && !body.params) {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } }],
            nextCursor: 'next',
          },
        });
      }
      if (body.method === 'tools/list' && body.params?.cursor === 'next') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{ name: 'sum', inputSchema: { type: 'object', properties: { n: { type: 'number' } } } }],
          },
        });
      }
      throw new Error(`unexpected ${body.method}`);
    });

    const client = await new McpClient({ fetch: fetchMock as unknown as typeof fetch, clientVersion: '9.8.7' })
      .connect('https://mcp.example.test/mcp', { Authorization: 'Bearer token' });
    const tools = await client.listTools();

    expect(client.mcpSessionId).toBe('session-123');
    expect(tools.map(tool => tool.name)).toEqual(['echo', 'sum']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const initialize = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(initialize).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'gatesai-chat', version: '9.8.7' },
      },
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'Mcp-Session-Id': 'session-123' });
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ 'Mcp-Session-Id': 'session-123' });
  });

  it('parses JSON and SSE responses from POST requests', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } },
        });
      }
      if (body.method === 'notifications/initialized') return accepted();
      if (body.method === 'tools/call') {
        return new Response([
          'event: message',
          'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
          '',
          'event: message',
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"hello"},{"type":"image","mimeType":"image/png"}],"isError":false}}`,
          '',
        ].join('\n'), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      throw new Error(`unexpected ${body.method}`);
    });

    const client = await new McpClient({ fetch: fetchMock as unknown as typeof fetch }).connect('https://mcp.example.test/mcp');
    const result = await client.callTool('render', { prompt: 'hi' });

    expect(result.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', mimeType: 'image/png' },
    ]);
    expect(result.isError).toBeUndefined();
    expect(parseSseJsonRpcResponses('data: [{"jsonrpc":"2.0","id":"1","result":{}}]\n\n')).toHaveLength(1);
  });

  it('maps HTTP auth failures to typed auth errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad token' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(new McpClient({ fetch: fetchMock as unknown as typeof fetch }).connect('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ kind: 'auth', status: 401, message: 'bad token' });
  });

  it('maps request timeout to typed timeout errors', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    );

    await expect(new McpClient({ fetch: fetchMock as unknown as typeof fetch, requestTimeoutMs: 5 }).connect('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('throws protocol errors for JSON-RPC errors and version mismatches', async () => {
    const rpcErrorFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number };
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'unsupported' },
      });
    });

    await expect(new McpClient({ fetch: rpcErrorFetch as unknown as typeof fetch }).connect('https://mcp.example.test/mcp'))
      .rejects.toMatchObject({ kind: 'protocol', code: -32602 });

    const oldVersionFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number };
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'old', version: '1' } },
      });
    });

    const promise = new McpClient({ fetch: oldVersionFetch as unknown as typeof fetch }).connect('https://mcp.example.test/mcp');
    await expect(promise).rejects.toBeInstanceOf(McpError);
    await expect(promise).rejects.toMatchObject({ kind: 'protocol' });
  });
});

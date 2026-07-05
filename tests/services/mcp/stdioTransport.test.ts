import { describe, expect, it, vi } from 'vitest';
import { McpClient } from '../../../src/services/mcp/client';
import { McpStdioTransport, type McpStdioExitEvent, type McpStdioMessageEvent } from '../../../src/services/mcp/stdioTransport';

type Handler<T> = (event: { payload: T }) => void;

class FakeTauriBus {
  readonly calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  onSend: ((payload: string) => void) | null = null;
  private readonly handlers = new Map<string, Handler<unknown>[]>();

  invoke = vi.fn(async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    this.calls.push({ cmd, args });
    if (cmd === 'mcp_stdio_send' && typeof args?.payload === 'string') {
      this.onSend?.(args.payload);
    }
    return undefined as T;
  });

  listen = vi.fn(async <T,>(event: string, handler: Handler<T>) => {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler as Handler<unknown>);
    this.handlers.set(event, handlers);
    return () => {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter(item => item !== handler));
    };
  });

  emit<T>(event: string, payload: T): void {
    for (const handler of this.handlers.get(event) ?? []) handler({ payload });
  }
}

function transport(bus: FakeTauriBus, options: Partial<ConstructorParameters<typeof McpStdioTransport>[1]> = {}) {
  return new McpStdioTransport({
    id: 'srv',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
    env: {},
  }, {
    invoke: bus.invoke as unknown as NonNullable<ConstructorParameters<typeof McpStdioTransport>[1]>['invoke'],
    listen: bus.listen as unknown as NonNullable<ConstructorParameters<typeof McpStdioTransport>[1]>['listen'],
    ...options,
  });
}

function message(id: string, line: unknown): McpStdioMessageEvent {
  return { id, line: JSON.stringify(line) };
}

describe('McpStdioTransport', () => {
  it('runs the shared MCP handshake over stdio JSON-RPC lines', async () => {
    const bus = new FakeTauriBus();
    bus.onSend = payload => {
      const request = JSON.parse(payload) as { id?: number; method: string };
      if (request.method === 'initialize') {
        bus.emit('mcp-stdio-message', message('srv', {
          jsonrpc: '2.0',
          id: request.id,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } },
        }));
      }
      if (request.method === 'tools/list') {
        bus.emit('mcp-stdio-message', message('srv', {
          jsonrpc: '2.0',
          id: request.id,
          result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
        }));
      }
    };

    const client = await new McpClient({ transport: transport(bus) }).connect();
    const tools = await client.listTools();

    expect(tools.map(tool => tool.name)).toEqual(['echo']);
    expect(bus.calls.map(call => call.cmd)).toEqual([
      'mcp_stdio_start',
      'mcp_stdio_send',
      'mcp_stdio_send',
      'mcp_stdio_send',
    ]);
    const initialized = JSON.parse(String(bus.calls[2].args?.payload));
    expect(initialized).toMatchObject({ method: 'notifications/initialized' });
  });

  it('correlates concurrent responses by JSON-RPC id', async () => {
    const bus = new FakeTauriBus();
    const tx = transport(bus);
    await tx.start();

    const first = tx.send({ jsonrpc: '2.0', id: 1, method: 'one' }, { expectResponse: true });
    const second = tx.send({ jsonrpc: '2.0', id: 2, method: 'two' }, { expectResponse: true });
    bus.emit('mcp-stdio-message', message('srv', { jsonrpc: '2.0', id: 2, result: { value: 'second' } }));
    bus.emit('mcp-stdio-message', message('srv', { jsonrpc: '2.0', id: '1', result: { value: 'first' } }));

    await expect(first).resolves.toEqual([{ jsonrpc: '2.0', id: '1', result: { value: 'first' } }]);
    await expect(second).resolves.toEqual([{ jsonrpc: '2.0', id: 2, result: { value: 'second' } }]);
  });

  it('times out requests without a response', async () => {
    const bus = new FakeTauriBus();
    const tx = transport(bus, { requestTimeoutMs: 5 });
    await tx.start();

    await expect(tx.send({ jsonrpc: '2.0', id: 1, method: 'slow' }, { expectResponse: true }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('maps process exit while a request is pending to a connection error', async () => {
    const bus = new FakeTauriBus();
    const tx = transport(bus);
    await tx.start();

    const pending = tx.send({ jsonrpc: '2.0', id: 1, method: 'slow' }, { expectResponse: true });
    bus.emit<McpStdioExitEvent>('mcp-stdio-exit', { id: 'srv', code: 7 });

    await expect(pending).rejects.toMatchObject({
      kind: 'connect',
      message: 'MCP stdio server exited with code 7.',
    });
  });

  it('surfaces tools/list_changed notifications for store refresh', async () => {
    const bus = new FakeTauriBus();
    const onToolsListChanged = vi.fn();
    const tx = transport(bus, { onToolsListChanged });
    await tx.start();

    bus.emit('mcp-stdio-message', message('srv', {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    }));

    expect(onToolsListChanged).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../../src/services/tools/types';
import { ToolRegistry } from '../../../src/services/tools/registry';
import {
  MCP_TOOL_RESULT_MAX_CHARS,
  buildMcpToolBindings,
  createMcpRegistryTools,
  formatMcpToolResult,
  type McpConnectedToolServer,
  type McpToolSource,
} from '../../../src/services/mcp/toolIntegration';

function connectedServer(label: string, tools: McpConnectedToolServer['tools']): McpConnectedToolServer {
  return {
    server: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label,
    },
    tools,
  };
}

function emptyContext(): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    threadId: 't1',
  } as unknown as ToolContext;
}

describe('MCP tool integration', () => {
  it('sanitizes provider tool names, caps them at 64 chars, and dedupes collisions', () => {
    const bindings = buildMcpToolBindings([
      connectedServer('Local Tools!', [
        { name: 'run tool', inputSchema: { type: 'object' } },
        { name: 'run_tool', inputSchema: { type: 'object' } },
        { name: 'tool '.repeat(30), inputSchema: { type: 'object' } },
      ]),
    ]);

    expect(bindings.map(binding => binding.exposedName).slice(0, 2)).toEqual([
      'mcp_local_tools_run_tool',
      'mcp_local_tools_run_tool_2',
    ]);
    expect(bindings.every(binding => /^[a-zA-Z0-9_-]+$/.test(binding.exposedName))).toBe(true);
    expect(bindings.every(binding => binding.exposedName.length <= 64)).toBe(true);
  });

  it('passes MCP input schemas through to provider tool definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
      required: ['mode'],
      additionalProperties: false,
    };
    const [binding] = buildMcpToolBindings([
      connectedServer('Schema Server', [{ name: 'query', description: 'Run query', inputSchema: schema }]),
    ]);
    const registry = new ToolRegistry();
    registry.registerDynamicProvider(() => createMcpRegistryTools({
      connectedServers: [connectedServer('Schema Server', [{ name: 'query', description: 'Run query', inputSchema: schema }])],
      callTool: vi.fn(),
    }));

    expect(binding.def.parameters).toBe(schema);
    expect(registry.validateCallDetailed(binding.exposedName, { mode: 123 }).ok).toBe(true);
  });

  it('advertises MCP tools only while the source reports connected servers', () => {
    const registry = new ToolRegistry();
    const source: McpToolSource = {
      connectedServers: [],
      callTool: vi.fn(),
    };
    registry.registerDynamicProvider(() => createMcpRegistryTools(source));

    expect(registry.toolDefsForTurn({ userText: 'hello', bridgeOnline: false })).toEqual([]);

    source.connectedServers.push(connectedServer('Remote', [
      { name: 'search', description: 'Search remote data', inputSchema: { type: 'object' } },
    ]));

    expect(registry.toolDefsForTurn({ userText: 'hello', bridgeOnline: false }).map(def => def.name))
      .toEqual(['mcp_remote_search']);
  });

  it('routes execution to the owning MCP client and maps text results', async () => {
    const registry = new ToolRegistry();
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'remote result' }],
    }));
    registry.registerDynamicProvider(() => createMcpRegistryTools({
      connectedServers: [connectedServer('Remote', [
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      ])],
      callTool,
    }));

    const result = await registry.execute('mcp_remote_echo', { text: 'hi' }, emptyContext());

    expect(callTool).toHaveBeenCalledWith('remote', 'echo', { text: 'hi' }, undefined);
    expect(result).toMatchObject({ ok: true, content: 'remote result' });
  });

  it('formats mixed content, tool errors, and truncates large output', () => {
    expect(formatMcpToolResult('mcp_remote_mixed', {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'resource://x' } },
      ],
    }).content).toBe('hello\n\n[image]\n\n[resource]');

    const error = formatMcpToolResult('mcp_remote_fail', {
      isError: true,
      content: [{ type: 'text', text: 'denied' }],
    });
    expect(error.ok).toBe(false);
    expect(error.content).toContain('error_code: mcp_tool_error');
    expect(error.content).toContain('denied');

    const huge = formatMcpToolResult('mcp_remote_big', {
      content: [{ type: 'text', text: 'x'.repeat(MCP_TOOL_RESULT_MAX_CHARS + 500) }],
    });
    expect(huge.content.length).toBeLessThanOrEqual(MCP_TOOL_RESULT_MAX_CHARS);
    expect(huge.content).toContain('[truncated ');
  });
});

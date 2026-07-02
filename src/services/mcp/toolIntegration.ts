import type { JsonSchema, ToolDef } from '../../core/llm';
import type { Tool, ToolExecuteResult } from '../tools/types';
import type { McpTool, McpToolResult } from './client';

export const MCP_TOOL_RESULT_MAX_CHARS = 32_000;
const TOOL_NAME_MAX_CHARS = 64;

export interface McpToolBinding {
  exposedName: string;
  serverId: string;
  serverLabel: string;
  remoteName: string;
  tool: McpTool;
  def: ToolDef;
}

export interface McpConnectedToolServer {
  server: {
    id: string;
    label: string;
  };
  tools: McpTool[];
}

export interface McpToolSource {
  readonly connectedServers: McpConnectedToolServer[];
  callTool(serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
}

export function createMcpRegistryTools(source: McpToolSource): Tool[] {
  return buildMcpToolBindings(source.connectedServers).map(binding => ({
    def: binding.def,
    meta: {
      category: 'mcp',
      risk: 'medium',
      capabilityId: 'mcp.tool',
    },
    ui: {
      verb: () => 'MCP',
      target: () => `${binding.serverLabel}.${binding.remoteName}`,
      summary: result => result.summary,
    },
    execute: async (args, ctx) => {
      const result = await source.callTool(binding.serverId, binding.remoteName, args, ctx.signal);
      return formatMcpToolResult(binding.def.name, result);
    },
  }));
}

export function buildMcpToolBindings(servers: McpConnectedToolServer[]): McpToolBinding[] {
  const used = new Set<string>();
  const bindings: McpToolBinding[] = [];
  for (const { server, tools } of servers) {
    const serverPart = sanitizeToolNamePart(server.label, server.id);
    for (const tool of tools) {
      const toolPart = sanitizeToolNamePart(tool.name, 'tool');
      const base = `mcp_${serverPart}_${toolPart}`;
      const exposedName = uniqueToolName(base, used);
      const description = `[${server.label}] ${tool.description?.trim() || tool.name}`;
      const def: ToolDef = {
        name: exposedName,
        description,
        parameters: mcpInputSchema(tool),
      };
      bindings.push({
        exposedName,
        serverId: server.id,
        serverLabel: server.label,
        remoteName: tool.name,
        tool,
        def,
      });
    }
  }
  return bindings;
}

export function formatMcpToolResult(toolName: string, result: McpToolResult): ToolExecuteResult {
  const body = formatMcpContent(result);
  const rawContent = result.isError
    ? [
        'status: error',
        `tool: ${toolName}`,
        'error_code: mcp_tool_error',
        'summary: MCP tool returned an error result.',
        'retryable: true',
        'content:',
        body,
      ].join('\n')
    : body;
  const content = truncateMcpToolResult(rawContent);
  return {
    content,
    summary: result.isError ? 'MCP tool returned an error result.' : summarizeMcpBody(body),
    ok: !result.isError,
    ...(result.isError ? { errorCode: 'mcp_tool_error', retryable: true } : {}),
  };
}

export function formatMcpContent(result: McpToolResult): string {
  const parts = result.content.map(item => {
    if (item.type === 'text') {
      return typeof item.text === 'string' && item.text.trim() ? item.text : '';
    }
    if (item.type === 'image') return '[image]';
    if (item.type === 'audio') return '[audio]';
    if (item.type === 'resource') return '[resource]';
    return `[${item.type || 'content'}]`;
  }).filter(part => part.trim().length > 0);
  return parts.length > 0 ? parts.join('\n\n') : '[no content]';
}

function truncateMcpToolResult(content: string): string {
  if (content.length <= MCP_TOOL_RESULT_MAX_CHARS) return content;
  const omitted = content.length - MCP_TOOL_RESULT_MAX_CHARS;
  const note = `\n\n[truncated ${omitted} chars from MCP tool result]`;
  const keep = Math.max(0, MCP_TOOL_RESULT_MAX_CHARS - note.length);
  return `${content.slice(0, keep).trimEnd()}${note}`;
}

function summarizeMcpBody(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (!compact || compact === '[no content]') return 'MCP tool returned no content.';
  return compact.length > 180 ? `${compact.slice(0, 180).trimEnd()}...` : compact;
}

function mcpInputSchema(tool: McpTool): JsonSchema {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)) {
    return tool.inputSchema as JsonSchema;
  }
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}

function sanitizeToolNamePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || fallback.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'tool';
}

function uniqueToolName(base: string, used: Set<string>): string {
  let suffix = '';
  let next = 1;
  let candidate = truncateToolName(base, suffix);
  while (used.has(candidate)) {
    next += 1;
    suffix = `_${next}`;
    candidate = truncateToolName(base, suffix);
  }
  used.add(candidate);
  return candidate;
}

function truncateToolName(base: string, suffix: string): string {
  const maxBase = TOOL_NAME_MAX_CHARS - suffix.length;
  const trimmed = base.slice(0, maxBase).replace(/[_-]+$/g, '');
  const candidate = `${trimmed || 'mcp_tool'}${suffix}`;
  return candidate.slice(0, TOOL_NAME_MAX_CHARS);
}

// Defines the registry tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { JsonSchema, ToolCall, ToolDef } from '../../core/llm';
import type { Tool, ToolContext, ToolExecuteResult, ToolOutcome, ToolValidationIssue } from './types';
import { defaultToolUi, summarizeToolResult } from './activityDisplay';
import { memoryTool } from './memory';
import { timeTool } from './time';
import { logsTool } from './logs';
import { notesTool } from './notes';
import { threadTool } from './thread';
import { chatHistoryTool } from './chatHistory';
import { fsTool } from './fs';
import { terminalTool } from './terminal';
import { pythonInlineTool } from './pythonInline';
import { sqliteQueryTool } from './sqliteQuery';
import { queryScriptTool } from './queryScript';
import { gitTool } from './git';
import { workspaceTool } from './workspace';
import { inspectFileTool } from './inspectFile';
import { imageGenerateTool } from './imageGenerate';
import { describeImageTool } from './describeImage';
import { webSearchTool } from './webSearch';
import { artifactTool } from './artifact';
import { sourceWorkspaceTool } from './sourceWorkspace';
import { sourceBuildTool } from './sourceBuild';

export interface ToolSelectionContext {
  userText: string;
  bridgeOnline: boolean;
  /**
   * Whether ComfyUI is enabled and healthy for this session. The model should
   * never see image generation tools unless the backend can actually run them.
   */
  imageGenAvailable?: boolean;
  webSearchAvailable?: boolean;
}

export interface ToolValidationResult {
  ok: boolean;
  toolName: string;
  errorCode?: string;
  summary?: string;
  fix?: string;
  retryable?: boolean;
  content?: string;
}

/**
 * The set of tools the model is allowed to call. Always-on for now — every
 * thread on every model gets the full list, no per-tool / per-thread toggles.
 * If the catalog grows past ~20 we'll revisit, but the model is perfectly
 * capable of ignoring tools it doesn't need.
 *
 * Adding a tool: write it under `services/tools/<name>.ts`, then register it
 * here. The default export is a singleton so consumers don't have to thread
 * the registry through stores.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.def.name, {
      ...tool,
      ui: tool.ui ?? defaultToolUi(tool.def.name),
    });
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** The shape providers want — array of `ToolDef`. Empty when no tools registered. */
  toolDefs(): ToolDef[] {
    return this.list().map(t => t.def);
  }

  toolDefsForTurn(ctx: ToolSelectionContext): ToolDef[] {
    const text = ctx.userText.toLowerCase();
    const selected = new Set<string>([
      'memory',
      'thread',
      'chat_history',
      'source_workspace',
      'source_build',
      'logs',
    ]);
    const bridgeRelevant = ctx.bridgeOnline || /\b(file|files|attachment|attached|csv|json|data|dataset|text|txt|code|script|command|terminal|shell|git|build|test|workspace|artifact|artifacts|folder|directory|read|write|html|htm|webpage|website|page|game|canvas|app|demo|prototype|ui)\b/.test(text);
    const notesRelevant = /\b(note|notes|plan|plans|document|documents|doc|docs|memory|remember|search|list|read|write)\b/.test(text);
    const imageGenRelevant = /\b(draw|drawing|paint|render|generate|make|create|design|illustrate|picture|image|photo|artwork|poster|logo|illustration|visual|scene|portrait|landscape|background|wallpaper)\b.*\b(image|picture|photo|art|artwork|drawing|poster|logo|illustration|scene|portrait|landscape|background|wallpaper)\b|\b(image[-_ ]?gen|imagegen|flux|stable ?diffusion|dall[-_ ]?e|midjourney|background|wallpaper)\b/i.test(text);
    const imageVisionRelevant = /\b(describe|caption|inspect|analy[sz]e|what(?:'s| is)|read)\b.*\b(image|picture|photo|screenshot|attachment|visual)\b|\b(image|picture|photo|screenshot)\b.*\b(describe|caption|inspect|analy[sz]e|read)\b/i.test(text);

    if (bridgeRelevant) {
      selected.add('workspace');
      selected.add('fs');
      selected.add('inspect_file');
      selected.add('artifact');
      selected.add('terminal');
      selected.add('python_inline');
      selected.add('sqlite_query');
      selected.add('query_script');
      selected.add('git');
    }
    if (notesRelevant) selected.add('notes');
    if (ctx.webSearchAvailable) selected.add('web_search');
    if (ctx.imageGenAvailable && imageGenRelevant) selected.add('image_generate');
    if (imageVisionRelevant) {
      selected.add('workspace');
      selected.add('fs');
      selected.add('describe_image');
    }

    const out = this.list().filter(t => selected.has(t.def.name)).map(t => t.def);
    return out.length > 0 ? out : this.toolDefs();
  }

  isReadOnlyCall(name: string, args: Record<string, unknown>): boolean {
    const tool = this.get(name);
    if (!tool?.meta) return false;
    if (tool.meta.isReadOnly) return tool.meta.isReadOnly(args);
    if (tool.meta.hasSideEffects) return !tool.meta.hasSideEffects(args);
    return false;
  }

  validateToolCall(call: ToolCall): ToolValidationResult {
    if (call.argumentsError) {
      return validationFailure(call.name, {
        errorCode: 'malformed_arguments',
        summary: `Tool arguments for ${call.name} were not valid JSON.`,
        fix: 'Retry the tool call with a complete JSON object matching the tool schema. Do not send placeholders or partial arguments. For finished HTML games/apps, prefer artifact.create_html_artifact with path and content.',
        retryable: true,
      });
    }
    return this.validateCallDetailed(call.name, call.arguments);
  }

  validateCallDetailed(name: string, args: Record<string, unknown> | undefined): ToolValidationResult {
    const tool = this.get(name);
    if (!tool) {
      return validationFailure(name, {
        errorCode: 'unknown_tool',
        summary: unknownToolSummary(name),
        fix: unknownToolFix(name),
        retryable: true,
      });
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return validationFailure(name, {
        errorCode: 'invalid_arguments',
        summary: `Invalid arguments for ${name}; expected an object.`,
        fix: 'Retry with a JSON object containing the required parameters for this tool.',
        retryable: true,
      });
    }
    const schemaIssue = validateObjectSchema(tool.def.parameters, args, name);
    if (schemaIssue) return validationFailure(name, schemaIssue);
    const toolIssue = tool.meta?.validate?.(args);
    if (toolIssue) return validationFailure(name, toolIssue);
    return { ok: true, toolName: name };
  }

  validateCall(name: string, args: Record<string, unknown> | undefined): string | null {
    const result = this.validateCallDetailed(name, args);
    return result.ok ? null : result.content ?? `Error: invalid tool call for ${name}.`;
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecuteResult> {
    const tool = this.get(name);
    const validation = this.validateCallDetailed(name, args);
    if (!validation.ok) return validationResultToExecuteResult(validation);
    if (!tool) return validationResultToExecuteResult(validationFailure(name, {
      errorCode: 'unknown_tool',
      summary: unknownToolSummary(name),
      fix: unknownToolFix(name),
      retryable: true,
    }));
    try {
      const out = await tool.execute(args, ctx);
      return normalizeToolOutput(name, out);
    } catch (err) {
      const summary = `Error executing ${name}: ${(err as Error).message}`;
      return {
        content: serializeToolOutcome(name, {
          ok: false,
          errorCode: 'execution_exception',
          summary,
          fix: 'Inspect the error, correct the inputs or environment, and retry only if the operation is still needed.',
          retryable: true,
        }),
        summary,
        ok: false,
        errorCode: 'execution_exception',
        retryable: true,
      };
    }
  }
}

function validationFailure(toolName: string, issue: ToolValidationIssue): ToolValidationResult {
  return {
    ok: false,
    toolName,
    errorCode: issue.errorCode,
    summary: issue.summary,
    fix: issue.fix,
    retryable: issue.retryable ?? true,
    content: serializeToolOutcome(toolName, {
      ok: false,
      errorCode: issue.errorCode,
      summary: issue.summary,
      fix: issue.fix,
      retryable: issue.retryable ?? true,
    }),
  };
}

function validationResultToExecuteResult(result: ToolValidationResult): ToolExecuteResult {
  return {
    content: result.content ?? `status: error\ntool: ${result.toolName}\nsummary: invalid tool call`,
    summary: result.summary,
    ok: false,
    errorCode: result.errorCode,
    retryable: result.retryable,
  };
}

function normalizeToolOutput(name: string, out: string | ToolExecuteResult | ToolOutcome): ToolExecuteResult {
  if (typeof out === 'string') {
    const result = { content: out, ok: !/^Error(?: executing [\w-]+)?:/i.test(out.trim()) };
    return {
      ...result,
      summary: summarizeToolResult(name, result),
    };
  }
  if ('summary' in out && 'ok' in out && !('content' in out)) {
    return {
      content: serializeToolOutcome(name, out),
      summary: out.summary,
      artifacts: out.ok ? out.artifacts : undefined,
      ok: out.ok,
      errorCode: out.ok ? undefined : out.errorCode,
      retryable: out.ok ? undefined : out.retryable,
      data: out.data,
    };
  }
  const result = {
    ...out,
    content: typeof out.content === 'string'
      ? out.content
      : serializeToolOutcome(name, {
          ok: false,
          errorCode: 'invalid_tool_result',
          summary: `Tool ${name} returned an invalid non-string content field.`,
          fix: 'Retry the operation or inspect the tool implementation.',
          retryable: true,
        }),
  };
  return {
    ...result,
    summary: result.summary ?? summarizeToolResult(name, result),
  };
}

export function serializeToolOutcome(name: string, outcome: ToolOutcome): string {
  const lines = [
    `status: ${outcome.ok ? 'ok' : 'error'}`,
    `tool: ${name}`,
  ];
  if (!outcome.ok) lines.push(`error_code: ${outcome.errorCode}`);
  lines.push(`summary: ${outcome.summary}`);
  if (!outcome.ok && outcome.fix) lines.push(`fix: ${outcome.fix}`);
  if (!outcome.ok) lines.push(`retryable: ${outcome.retryable ? 'true' : 'false'}`);
  if (outcome.data !== undefined) lines.push(`data: ${safeInlineJson(outcome.data)}`);
  return lines.join('\n');
}

function validateObjectSchema(schema: JsonSchema, args: Record<string, unknown>, toolName: string): ToolValidationIssue | null {
  const required = schema.required ?? [];
  for (const key of required) {
    if (isMissing(args[key])) {
      return {
        errorCode: 'missing_required_argument',
        summary: `\`${key}\` is required for ${toolName}.`,
        fix: requiredHint(toolName, key) || `Retry with \`${key}\` set to a valid value.`,
        retryable: true,
      };
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        return {
          errorCode: 'unknown_argument',
          summary: `Unknown argument \`${key}\` for ${toolName}.`,
          fix: `Remove \`${key}\` and use only documented parameters for ${toolName}.`,
          retryable: true,
        };
      }
      continue;
    }
    if (value == null) continue;
    const typeIssue = validateJsonValue(prop, value, `${toolName}.${key}`);
    if (typeIssue) return typeIssue;
  }
  return null;
}

function validateJsonValue(schema: JsonSchema, value: unknown, label: string): ToolValidationIssue | null {
  if (schema.enum && !schema.enum.includes(value)) {
    return {
      errorCode: 'invalid_enum_value',
      summary: `Invalid value for ${label}: ${JSON.stringify(value)}.`,
      fix: `Use one of: ${schema.enum.map(v => JSON.stringify(v)).join(', ')}.`,
      retryable: true,
    };
  }
  if (!matchesJsonType(schema.type, value)) {
    return {
      errorCode: 'invalid_argument_type',
      summary: `Invalid type for ${label}; expected ${schema.type}.`,
      fix: `Retry with ${label} as ${article(schema.type)} ${schema.type}.`,
      retryable: true,
    };
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const issue = validateJsonValue(schema.items, value[i], `${label}[${i}]`);
      if (issue) return issue;
    }
  }
  return null;
}

function matchesJsonType(type: JsonSchema['type'], value: unknown): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === type;
}

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function article(type: string): string {
  return /^[aeiou]/i.test(type) ? 'an' : 'a';
}

function unknownToolSummary(name: string): string {
  if (name === 'write' || name === 'functions.write') {
    return 'Unknown tool "write". Use `fs` with `action: "write"` instead.';
  }
  return `Unknown tool "${name}".`;
}

function unknownToolFix(name: string): string {
  if (name === 'write' || name === 'functions.write') {
    return 'Retry with tool `fs` and arguments like { "action": "write", "path": "/workspace/notes/file.txt", "content": "..." }.';
  }
  const known = toolRegistry?.list?.().map(tool => tool.def.name) ?? [];
  return known.length ? `Use one of the available tools: ${known.join(', ')}.` : 'Use a registered tool name.';
}

function requiredHint(name: string, key: string): string {
  if (name === 'fs' && key === 'action') {
    return 'Retry with `action` set to one of: read, write, append, list, delete, move, copy, mkdir, stat, search.';
  }
  if (name === 'terminal' && key === 'cmd') {
    return 'Provide the executable basename in `cmd`, with arguments in `args`.';
  }
  return '';
}

function safeInlineJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (!json) return 'null';
    return json.length > 1200 ? `${json.slice(0, 1200)}...[truncated ${json.length - 1200} chars]` : json;
  } catch {
    return '"[unserializable]"';
  }
}

export const toolRegistry = new ToolRegistry();
toolRegistry.register(memoryTool);
toolRegistry.register(timeTool);
toolRegistry.register(logsTool);
toolRegistry.register(notesTool);
toolRegistry.register(threadTool);
toolRegistry.register(chatHistoryTool);
toolRegistry.register(workspaceTool);
toolRegistry.register(sourceWorkspaceTool);
toolRegistry.register(sourceBuildTool);
toolRegistry.register(fsTool);
toolRegistry.register(inspectFileTool);
toolRegistry.register(artifactTool);
toolRegistry.register(terminalTool);
toolRegistry.register(pythonInlineTool);
toolRegistry.register(sqliteQueryTool);
toolRegistry.register(queryScriptTool);
toolRegistry.register(gitTool);
toolRegistry.register(imageGenerateTool);
toolRegistry.register(describeImageTool);
toolRegistry.register(webSearchTool);

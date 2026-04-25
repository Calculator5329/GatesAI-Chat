import type { ToolDef } from '../../core/llm';
import type { Tool, ToolContext } from './types';
import { memoryTool } from './memory';
import { timeTool } from './time';
import { notesTool } from './notes';
import { threadTool } from './thread';
import { fsTool } from './fs';
import { terminalTool } from './terminal';
import { pythonInlineTool } from './pythonInline';
import { sqliteQueryTool } from './sqliteQuery';
import { queryScriptTool } from './queryScript';
import { gitTool } from './git';
import { workspaceTool } from './workspace';
import { inspectFileTool } from './inspectFile';

export interface ToolSelectionContext {
  userText: string;
  bridgeOnline: boolean;
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
    this.tools.set(tool.def.name, tool);
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
    const selected = new Set<string>(['memory', 'thread']);
    const bridgeRelevant = ctx.bridgeOnline || /\b(file|files|attachment|attached|csv|json|data|dataset|text|txt|code|script|command|terminal|shell|git|build|test|workspace|artifact|artifacts|folder|directory|read|write)\b/.test(text);
    const notesRelevant = /\b(note|notes|plan|plans|document|documents|doc|docs|memory|remember|search|list|read|write)\b/.test(text);

    if (bridgeRelevant) {
      selected.add('workspace');
      selected.add('fs');
      selected.add('inspect_file');
      selected.add('terminal');
      selected.add('python_inline');
      selected.add('sqlite_query');
      selected.add('query_script');
      selected.add('git');
    }
    if (notesRelevant) selected.add('notes');

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

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.get(name);
    if (!tool) return `Error: unknown tool "${name}".`;
    try {
      return await tool.execute(args, ctx);
    } catch (err) {
      return `Error executing ${name}: ${(err as Error).message}`;
    }
  }
}

export const toolRegistry = new ToolRegistry();
toolRegistry.register(memoryTool);
toolRegistry.register(timeTool);
toolRegistry.register(notesTool);
toolRegistry.register(threadTool);
toolRegistry.register(workspaceTool);
toolRegistry.register(fsTool);
toolRegistry.register(inspectFileTool);
toolRegistry.register(terminalTool);
toolRegistry.register(pythonInlineTool);
toolRegistry.register(sqliteQueryTool);
toolRegistry.register(queryScriptTool);
toolRegistry.register(gitTool);

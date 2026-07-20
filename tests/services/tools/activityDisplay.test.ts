import { describe, expect, it } from 'vitest';
import { ToolRegistry, toolRegistry } from '../../../src/services/tools/registry';
import { summarizeToolResult, toolDisplayText } from '../../../src/services/tools/activityDisplay';

describe('tool activity display metadata', () => {
  it('exposes ambient labels for every registered tool', () => {
    const missing = toolRegistry.list().filter(tool => !tool.ui?.verb);

    expect(missing.map(tool => tool.def.name)).toEqual([]);
  });

  it('adds the shared display_text field to every registered tool schema', () => {
    const missing = toolRegistry.toolDefs().filter(def => !def.parameters.properties?.display_text);

    expect(missing.map(def => def.name)).toEqual([]);
    expect(toolRegistry.get('fs')?.def.parameters.properties?.display_text?.description).toContain('plain-English');
    expect(toolRegistry.validateCallDetailed('fs', {
      action: 'read',
      path: '/workspace/notes/plan.md',
      display_text: 'Checking the saved plan',
    }).ok).toBe(true);
  });

  it('strips display_text before executing the underlying tool', async () => {
    const registry = new ToolRegistry();
    let executedArgs: Record<string, unknown> | undefined;
    registry.register({
      def: {
        name: 'probe',
        description: 'Probe tool.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      meta: { category: 'diagnostics' },
      execute: async args => {
        executedArgs = args;
        return 'ok';
      },
    });

    const result = await registry.execute('probe', {
      value: 'kept',
      display_text: 'Checking the integration',
    }, { profile: undefined, chat: undefined, threadId: 't-test' } as never);

    expect(result.ok).toBe(true);
    expect(executedArgs).toEqual({ value: 'kept' });
  });

  it('bounds display_text to safe single-line UI copy', () => {
    expect(toolDisplayText({ display_text: '  Checking\n the\tproject tests  ' })).toBe('Checking the project tests');
    expect(toolDisplayText({ display_text: 'x'.repeat(180) })).toHaveLength(120);
    expect(toolDisplayText({ display_text: 42 })).toBeUndefined();
  });

  it('keeps ToolOutcome summaries as first-class execute results', async () => {
    const result = await toolRegistry.execute('artifact', {
      action: 'validate_html',
      path: '/workspace/artifacts/reports/demo.html',
    }, {
      profile: undefined,
      chat: undefined,
      threadId: 't-test',
      bridge: {
        isOnline: false,
        client: { request: async () => ({}) },
      },
    } as never);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Bridge offline. Start gatesai-bridge.');
    expect(summarizeToolResult('artifact', result)).toBe('Bridge offline. Start gatesai-bridge.');
  });

  it('persists default summaries for plain string tool results', async () => {
    const result = await toolRegistry.execute('time', {}, {
      profile: undefined,
      chat: undefined,
      threadId: 't-test',
    } as never);

    expect(result.summary).toBeTruthy();
    expect(summarizeToolResult('time', result)).toBe(result.summary);
  });

  it('formats tool call targets without parsing result content', () => {
    const fsTool = toolRegistry.get('fs');
    const searchTool = toolRegistry.get('web_search');
    const fetchPageTool = toolRegistry.get('fetch_page');

    expect(fsTool?.ui?.verb({ action: 'write' })).toBe('Writing');
    expect(fsTool?.ui?.target?.({ path: '/workspace/artifacts/reports/demo.html' })).toBe('demo.html');
    expect(searchTool?.ui?.verb({ queries: ['react 19 release notes'] })).toBe('Searching');
    expect(searchTool?.ui?.target?.({ queries: ['react 19 release notes'] })).toBe('react 19 release notes');
    expect(fetchPageTool?.ui?.verb({ url: 'https://example.com/a' })).toBe('Reading');
    expect(fetchPageTool?.ui?.target?.({ url: 'https://example.com/a' })).toBe('example.com');
    expect(fetchPageTool?.ui?.summary?.({
      content: 'Source: https://docs.example.com/a\nTitle: Docs\n\nText',
      ok: true,
    })).toBe('docs.example.com');
  });
});

import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import { summarizeToolResult } from '../../../src/services/tools/activityDisplay';

describe('tool activity display metadata', () => {
  it('exposes ambient labels for every registered tool', () => {
    const missing = toolRegistry.list().filter(tool => !tool.ui?.verb);

    expect(missing.map(tool => tool.def.name)).toEqual([]);
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

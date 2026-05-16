import { describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import type { ToolContext } from '../../../src/services/tools/types';

describe('web_search tool', () => {
  it('rejects invalid query counts', () => {
    expect(toolRegistry.validateCallDetailed('web_search', { queries: [] }).errorCode).toBe('invalid_query_count');
    expect(toolRegistry.validateCallDetailed('web_search', { queries: ['a', 'b', 'c', 'd'] }).errorCode).toBe('invalid_query_count');
  });

  it('de-dupes queries and formats partial failures', async () => {
    const searchBraveContext = vi.fn(async (input: { queries: string[] }) => {
      expect(input.queries).toEqual(['React 19', 'Vite 8']);
      return [
        {
          query: 'React 19',
          ok: true,
          sources: [{ title: 'React', url: 'https://react.dev', text: 'React context.' }],
        },
        {
          query: 'Vite 8',
          ok: false,
          sources: [],
          errorCode: 'rate_limited',
          summary: 'Too many requests.',
        },
      ];
    });
    const result = await toolRegistry.execute('web_search', {
      queries: [' React 19 ', 'react   19', 'Vite 8'],
      freshness: 'pw',
    }, {
      ...baseContext(),
      search: {
        braveReady: true,
        searchBraveContext,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('query: React 19');
    expect(result.content).toContain('https://react.dev');
    expect(result.content).toContain('error_code: rate_limited');
  });

  it('returns a clear error when Brave is not configured', async () => {
    const result = await toolRegistry.execute('web_search', { queries: ['latest news'] }, {
      ...baseContext(),
      search: {
        braveReady: false,
        searchBraveContext: async () => [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('missing_brave_key');
    expect(result.content).toContain('Brave Search is not configured');
  });
});

function baseContext(): ToolContext {
  return {
    threadId: 't-1',
    profile: {
      facts: [],
      addFact: () => false,
      removeFactAt: () => null,
      removeFactMatching: () => null,
      updateFactAt: () => null,
      updateFactMatching: () => null,
    },
    chat: {
      threads: [],
      selectThread: () => false,
      renameThread: () => {},
      setThreadContext: () => {},
      llmComplete: async () => '',
    },
  };
}


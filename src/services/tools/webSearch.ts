// Defines the webSearch tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { BraveFreshness, BraveSearchDepth, BraveSearchQueryResult } from '../search/types';
import type { Tool, ToolValidationIssue } from './types';

const MAX_QUERIES = 6;
const QUERY_COUNT_LABEL = `1 to ${MAX_QUERIES}`;
const MAX_OUTPUT_CHARS = 16_000;
const MAX_SOURCE_TEXT_CHARS = 1200;
const FRESHNESS = ['pd', 'pw', 'pm', 'py'];

export const webSearchTool: Tool = {
  def: {
    name: 'web_search',
    description: [
      'Search the live web with Brave LLM Context for current facts, recent events, source-backed claims, or anything likely to have changed.',
      `Pass ${QUERY_COUNT_LABEL} independent search queries in one call. The tool runs them in parallel and returns source URLs plus extracted context.`,
      'Use concise queries. Cite returned URLs in the final answer when using web_search results.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: `One to ${MAX_QUERIES} web search queries.`,
        },
        freshness: {
          type: 'string',
          enum: FRESHNESS,
          description: 'Optional freshness filter: pd=24h, pw=7d, pm=31d, py=365d.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code for search ranking. Defaults to US.',
        },
        search_lang: {
          type: 'string',
          description: 'Two-letter search language. Defaults to en.',
        },
        depth: {
          type: 'string',
          enum: ['standard', 'deep'],
          description: 'Context budget. Use standard for quick answers and deep for a planned multi-source investigation.',
        },
      },
      required: ['queries'],
      additionalProperties: false,
    },
  },
  meta: {
    category: 'web',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: MAX_OUTPUT_CHARS, summarizeLargeOutput: true },
    validate: validateArgs,
  },

  async execute(args, ctx) {
    if (!ctx.search?.braveReady) {
      return {
        ok: false,
        errorCode: 'missing_brave_key',
        summary: 'Brave Search is not configured.',
        fix: 'Add a Brave Search API key under Models before using web_search.',
        retryable: false,
      };
    }
    const queries = uniqueQueries(args.queries as string[]);
    const results = await ctx.search.searchBraveContext({
      queries,
      freshness: freshnessArg(args.freshness),
      country: stringArg(args.country) ?? 'US',
      searchLang: stringArg(args.search_lang) ?? 'en',
      depth: depthArg(args.depth),
      signal: ctx.signal,
    });
    return {
      content: truncate(formatResults(results), MAX_OUTPUT_CHARS),
      ok: results.some(result => result.ok),
      errorCode: results.every(result => !result.ok) ? 'all_searches_failed' : undefined,
      retryable: results.some(result => !result.ok),
    };
  },
};

function validateArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  if (!Array.isArray(args.queries)) {
    return {
      errorCode: 'invalid_queries',
      summary: `\`queries\` must be an array of ${QUERY_COUNT_LABEL} non-empty strings.`,
      fix: 'Retry with `queries` like ["latest React release", "React 19 changes"].',
      retryable: true,
    };
  }
  const raw = args.queries;
  if (raw.some(value => typeof value !== 'string' || value.trim() === '')) {
    return {
      errorCode: 'empty_query',
      summary: 'Every query must be a non-empty string.',
      fix: 'Remove empty queries and retry.',
      retryable: true,
    };
  }
  const uniqueCount = uniqueQueries(raw as string[]).length;
  if (uniqueCount < 1 || uniqueCount > MAX_QUERIES) {
    return {
      errorCode: 'invalid_query_count',
      summary: `\`queries\` must contain ${QUERY_COUNT_LABEL} unique searches.`,
      fix: `Batch at most ${MAX_QUERIES} independent searches in one web_search call.`,
      retryable: true,
    };
  }
  if (typeof args.country === 'string' && args.country.trim() && !/^[a-z]{2}$/i.test(args.country.trim())) {
    return {
      errorCode: 'invalid_country',
      summary: '`country` must be a two-letter country code.',
      fix: 'Use a value like US, GB, CA, or omit country.',
      retryable: true,
    };
  }
  if (typeof args.search_lang === 'string' && args.search_lang.trim() && !/^[a-z]{2}$/i.test(args.search_lang.trim())) {
    return {
      errorCode: 'invalid_search_lang',
      summary: '`search_lang` must be a two-letter language code.',
      fix: 'Use a value like en, es, fr, or omit search_lang.',
      retryable: true,
    };
  }
  return null;
}

function uniqueQueries(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const query = value.trim().replace(/\s+/g, ' ');
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

function formatResults(results: BraveSearchQueryResult[]): string {
  const blocks = ['status: ok', 'tool: web_search'];
  for (const result of results) {
    blocks.push('', `query: ${result.query}`);
    if (!result.ok) {
      blocks.push(`status: error`, `error_code: ${result.errorCode ?? 'search_error'}`, `summary: ${result.summary ?? 'Search failed.'}`);
      continue;
    }
    if (result.sources.length === 0) {
      blocks.push('status: empty', 'summary: Brave returned no relevant grounding context.');
      continue;
    }
    result.sources.forEach((source, index) => {
      blocks.push(
        `[${index + 1}] ${source.title}`,
        `url: ${source.url}`,
        `context: ${truncate(source.text.replace(/\s+/g, ' ').trim(), MAX_SOURCE_TEXT_CHARS) || '(no extracted context)'}`,
      );
    });
  }
  return blocks.join('\n');
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function freshnessArg(value: unknown): BraveFreshness | undefined {
  return typeof value === 'string' && FRESHNESS.includes(value) ? value as BraveFreshness : undefined;
}

function depthArg(value: unknown): BraveSearchDepth {
  return value === 'deep' ? 'deep' : 'standard';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...[truncated ${value.length - max} chars]` : value;
}

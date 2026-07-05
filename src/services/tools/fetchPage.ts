// Defines the fetch_page tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on the Tauri fetch_page command.
// Invariant: Web Lite never attempts to invoke Tauri, and blocked internal URLs fail readably.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';
import type { Tool, ToolOutcome, ToolValidationIssue } from './types';

const DEFAULT_MAX_CHARS = 16_000;
const MAX_CHARS_CAP = 24_000;

interface FetchPageResult {
  final_url: string;
  status: number;
  title: string | null;
  content: string;
  truncated: boolean;
  content_type: string;
}

export const fetchPageTool: Tool = {
  def: {
    name: 'fetch_page',
    description: [
      'Read the readable text of a public web page by URL. Use this after web_search when snippets are not enough, or when the user gives a specific page to inspect.',
      'Only public HTTPS URLs are allowed. HTTP/HTTPS localhost URLs are allowed for local development. Private and internal network addresses are blocked.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page URL to read. Public pages must use https://.' },
        max_chars: { type: 'number', description: `Optional max characters to return. Defaults to ${DEFAULT_MAX_CHARS}; capped at ${MAX_CHARS_CAP}.` },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  meta: {
    category: 'web',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: MAX_CHARS_CAP, summarizeLargeOutput: true },
    validate: validateArgs,
  },
  async execute(args) {
    if (!isTauri()) {
      return {
        ok: false as const,
        errorCode: 'desktop_required',
        summary: 'fetch_page is only available in the GatesAI desktop app.',
        fix: 'Use the GatesAI desktop app to read full web pages, or rely on web_search snippets in Web Lite.',
        retryable: false,
      };
    }

    const url = String(args.url).trim();
    const maxChars = normalizeMaxChars(args.max_chars);
    try {
      const page = await invoke<FetchPageResult>('fetch_page', { url });
      const formatted = formatFetchPageResult(page, maxChars);
      return {
        content: formatted.content,
        summary: domainForUrl(page.final_url),
        ok: true,
        data: {
          finalUrl: page.final_url,
          status: page.status,
          title: page.title,
          contentType: page.content_type,
          truncated: formatted.truncated,
        },
      };
    } catch (err) {
      return errorResult(normalizeInvokeError(err));
    }
  },
};

function validateArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  if (typeof args.url === 'string' && args.url.trim() === '') {
    return {
      errorCode: 'empty_url',
      summary: '`url` must be a non-empty string.',
      fix: 'Retry with a full http://localhost, https://localhost, or public https:// URL.',
      retryable: true,
    };
  }
  if (args.max_chars != null && (typeof args.max_chars !== 'number' || !Number.isFinite(args.max_chars))) {
    return {
      errorCode: 'invalid_max_chars',
      summary: '`max_chars` must be a finite number.',
      fix: `Retry with a number between 1 and ${MAX_CHARS_CAP}, or omit max_chars.`,
      retryable: true,
    };
  }
  return null;
}

function normalizeMaxChars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(MAX_CHARS_CAP, Math.max(1, Math.floor(value)));
}

function formatFetchPageResult(page: FetchPageResult, maxChars: number): { content: string; truncated: boolean } {
  const title = page.title?.trim() || '(untitled)';
  const bodyTruncated = page.content.length > maxChars;
  const shown = bodyTruncated ? page.content.slice(0, maxChars) : page.content;
  const truncated = page.truncated || bodyTruncated;
  const note = truncated
    ? `\n\n[Truncated: ${page.truncated ? 'response body reached the 2 MB fetch cap' : `content limited to ${maxChars} chars by max_chars`}.]`
    : '';
  return {
    content: [
      `Source: ${page.final_url}`,
      `Title: ${title}`,
      `Status: ${page.status}`,
      `Content-Type: ${page.content_type || '(missing)'}`,
      '',
      `${shown}${note}`,
    ].join('\n'),
    truncated,
  };
}

function errorResult(message: string): ToolOutcome {
  const blocked = /blocked URL|not public|private|internal|169\.254|100\.64/i.test(message);
  if (blocked) {
    return {
      ok: false,
      errorCode: 'blocked_private_address',
      summary: `Blocked by URL policy: ${message}`,
      fix: 'Use a public https:// URL. fetch_page cannot probe private, reserved, metadata, or internal network addresses.',
      retryable: false,
    };
  }
  return {
    ok: false,
    errorCode: 'fetch_page_failed',
    summary: message || 'fetch_page failed.',
    fix: 'Check the URL and retry if the page is public and reachable.',
    retryable: true,
  };
}

function normalizeInvokeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
  }
  return String(err || '');
}

export function domainForUrl(value: string): string {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

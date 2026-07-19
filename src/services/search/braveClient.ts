// Wraps Brave Search context API calls and error normalization for web_search.
// Called by SearchStore and webSearchTool; depends on provider API keys, fetch/Tauri transport, and abort signals.
// Invariant: callers receive normalized sources or BraveSearchError codes.
import type { BraveSearchRequest, BraveSearchSource } from './types';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';
import { isRecord } from '../../core/guards';

const ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';
const DEFAULT_COUNT = 10;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 8000;

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface BraveClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tauriInvoke?: TauriInvoke;
  useTauri?: boolean;
}

interface BraveGroundingItem {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  text?: unknown;
  description?: unknown;
  snippet?: unknown;
  snippets?: unknown;
}

interface BraveLlmContextResponse {
  grounding?: {
    generic?: BraveGroundingItem[];
  };
}

export class BraveSearchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tauriInvoke: TauriInvoke;
  private readonly useTauri: boolean;

  constructor(opts: BraveClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tauriInvoke = opts.tauriInvoke ?? invoke;
    this.useTauri = opts.useTauri ?? (!opts.fetchImpl && isTauri());
  }

  async searchContext(apiKey: string, req: BraveSearchRequest): Promise<BraveSearchSource[]> {
    if (this.useTauri) return this.searchContextViaTauri(apiKey, req);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const url = buildBraveUrl(req);
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });
      if (!response.ok) {
        throw new BraveSearchError(errorCodeForStatus(response.status), `Brave Search returned HTTP ${response.status}.`);
      }
      return parseSources(await response.json());
    } catch (err) {
      if (req.signal?.aborted || controller.signal.aborted) {
        throw new BraveSearchError('timeout_or_aborted', 'Brave Search request timed out or was cancelled.');
      }
      if (err instanceof BraveSearchError) throw err;
      throw networkErrorForUnknown(err);
    } finally {
      clearTimeout(timeout);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async searchContextViaTauri(apiKey: string, req: BraveSearchRequest): Promise<BraveSearchSource[]> {
    if (req.signal?.aborted) {
      throw new BraveSearchError('timeout_or_aborted', 'Brave Search request timed out or was cancelled.');
    }
    try {
      const json = await abortable(this.tauriInvoke<BraveLlmContextResponse>('brave_llm_context', {
        apiKey,
        query: req.query,
        freshness: req.freshness,
        country: normalizeCountry(req.country),
        searchLang: normalizeSearchLang(req.searchLang),
      }), req.signal);
      return parseSources(json);
    } catch (err) {
      if (req.signal?.aborted) {
        throw new BraveSearchError('timeout_or_aborted', 'Brave Search request timed out or was cancelled.');
      }
      if (err instanceof BraveSearchError) throw err;
      throw braveErrorFromTauri(err);
    }
  }
}

export class BraveSearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BraveSearchError';
    this.code = code;
  }
}

function buildBraveUrl(req: BraveSearchRequest): string {
  const params = new URLSearchParams({
    q: req.query,
    count: String(DEFAULT_COUNT),
    maximum_number_of_tokens: String(DEFAULT_MAX_TOKENS),
    context_threshold_mode: 'balanced',
    country: normalizeCountry(req.country),
    search_lang: normalizeSearchLang(req.searchLang),
  });
  if (req.freshness) params.set('freshness', req.freshness);
  return `${ENDPOINT}?${params.toString()}`;
}

function parseSources(json: unknown): BraveSearchSource[] {
  const grounding = isRecord(json) && isRecord(json.grounding) ? json.grounding : {};
  const items = Array.isArray(grounding.generic) ? grounding.generic : [];
  return items
    .map((item): BraveSearchSource | null => {
      const url = stringValue(item.url);
      if (!url) return null;
      const title = stringValue(item.title) || url;
      const text = firstText(item.content, item.text, item.description, item.snippet, item.snippets);
      return { title, url, text };
    })
    .filter((source): source is BraveSearchSource => source !== null);
}


function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map(stringValue).filter(Boolean).join('\n');
      if (joined) return joined;
    }
    const text = stringValue(value);
    if (text) return text;
  }
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCountry(value: string | undefined): string {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^[A-Z]{2}$/.test(trimmed) ? trimmed : 'US';
}

function normalizeSearchLang(value: string | undefined): string {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[a-z]{2}$/.test(trimmed) ? trimmed : 'en';
}

function errorCodeForStatus(status: number): string {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'brave_unavailable';
  return 'brave_http_error';
}

function networkErrorForUnknown(err: unknown): BraveSearchError {
  const message = err instanceof Error ? err.message : String(err || '');
  if (/failed to fetch/i.test(message)) {
    return new BraveSearchError(
      'network_error',
      'Could not reach Brave Search from this runtime. If this is a browser/dev tab, the request may be blocked before HTTP by CORS; use the GatesAI desktop app or check outbound internet access.',
    );
  }
  return new BraveSearchError('network_error', message || 'Brave Search request failed.');
}

function braveErrorFromTauri(err: unknown): BraveSearchError {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    if (code && message) return new BraveSearchError(code, message);
  }
  if (typeof err === 'string') {
    try {
      return braveErrorFromTauri(JSON.parse(err));
    } catch {
      return new BraveSearchError('network_error', err);
    }
  }
  return networkErrorForUnknown(err);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new BraveSearchError('timeout_or_aborted', 'Brave Search request timed out or was cancelled.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new BraveSearchError('timeout_or_aborted', 'Brave Search request timed out or was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

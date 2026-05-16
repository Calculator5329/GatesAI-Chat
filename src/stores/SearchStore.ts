import { autorun, makeAutoObservable, toJS } from 'mobx';
import { BraveSearchClient, BraveSearchError } from '../services/search/braveClient';
import { loadSearchConfig, saveSearchConfig, type SearchPersistedConfig } from '../services/searchStorage';
import type { BraveFreshness, BraveSearchOptions, BraveSearchQueryResult, BraveSearchSource } from '../services/search/types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

interface CacheEntry {
  expiresAt: number;
  sources: BraveSearchSource[];
}

export class SearchStore {
  config: SearchPersistedConfig = {};
  private readonly client: Pick<BraveSearchClient, 'searchContext'>;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(client: Pick<BraveSearchClient, 'searchContext'> = new BraveSearchClient()) {
    this.client = client;
    this.config = loadSearchConfig();
    makeAutoObservable<this, 'client' | 'cache'>(this, {
      client: false,
      cache: false,
    });

    autorun(() => {
      saveSearchConfig(toJS(this.config));
    });
  }

  get braveReady(): boolean {
    return Boolean(this.config.brave?.apiKey);
  }

  get braveApiKey(): string {
    return this.config.brave?.apiKey ?? '';
  }

  setBraveKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      delete this.config.brave;
      this.cache.clear();
      return;
    }
    this.config.brave = { apiKey: trimmed };
  }

  clearBraveKey(): void {
    this.setBraveKey('');
  }

  async searchBraveContext(input: {
    queries: string[];
    freshness?: BraveFreshness;
    country?: string;
    searchLang?: string;
    signal?: AbortSignal;
  }): Promise<BraveSearchQueryResult[]> {
    const apiKey = this.config.brave?.apiKey;
    if (!apiKey) {
      return input.queries.map(query => ({
        query,
        ok: false,
        sources: [],
        errorCode: 'missing_brave_key',
        summary: 'Add a Brave Search API key in Models before using web_search.',
      }));
    }
    const options: BraveSearchOptions = {
      freshness: input.freshness,
      country: input.country,
      searchLang: input.searchLang,
    };
    return Promise.all(input.queries.map(query => this.searchOne(apiKey, query, options, input.signal)));
  }

  private async searchOne(
    apiKey: string,
    query: string,
    options: BraveSearchOptions,
    signal?: AbortSignal,
  ): Promise<BraveSearchQueryResult> {
    const key = cacheKey(query, options);
    const cached = this.getCached(key);
    if (cached) return { query, ok: true, sources: cached };

    try {
      const sources = await this.client.searchContext(apiKey, {
        query,
        freshness: options.freshness,
        country: options.country,
        searchLang: options.searchLang,
        signal,
      });
      this.setCached(key, sources);
      return { query, ok: true, sources };
    } catch (err) {
      const code = err instanceof BraveSearchError ? err.code : 'search_error';
      return {
        query,
        ok: false,
        sources: [],
        errorCode: code,
        summary: (err as Error).message || 'Brave Search failed.',
      };
    }
  }

  private getCached(key: string): BraveSearchSource[] | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.sources;
  }

  private setCached(key: string, sources: BraveSearchSource[]): void {
    this.cache.set(key, { sources, expiresAt: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

function cacheKey(query: string, options: BraveSearchOptions): string {
  return JSON.stringify({
    query: query.trim().replace(/\s+/g, ' ').toLowerCase(),
    freshness: options.freshness ?? '',
    country: (options.country ?? 'US').trim().toUpperCase(),
    searchLang: (options.searchLang ?? 'en').trim().toLowerCase(),
  });
}

// Owns observable SearchStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, reaction, toJS } from 'mobx';
import { BraveSearchClient, BraveSearchError } from '../services/search/braveClient';
import { loadSearchConfig, saveSearchConfig, type SearchPersistedConfig } from '../services/searchStorage';
import type { BraveFreshness, BraveSearchDepth, BraveSearchOptions, BraveSearchQueryResult, BraveSearchSource } from '../services/search/types';
import { logger } from '../services/diagnostics/logger';
import { deleteSecret, SECRET_NAMES, setSecret, usesTauriSecretBackend } from '../services/secretStorage';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

interface CacheEntry {
  expiresAt: number;
  sources: BraveSearchSource[];
}

interface SearchStoreOptions {
  autoPersist?: boolean;
  useKeychainSecrets?: boolean;
}

export class SearchStore {
  config: SearchPersistedConfig = {};
  private readonly client: Pick<BraveSearchClient, 'searchContext'>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly useKeychainSecrets: boolean;
  private configPersistenceDisposer: (() => void) | null = null;
  private secretPersistenceDisposer: (() => void) | null = null;

  constructor(
    client: Pick<BraveSearchClient, 'searchContext'> = new BraveSearchClient(),
    options: SearchStoreOptions = {},
  ) {
    this.client = client;
    this.useKeychainSecrets = options.useKeychainSecrets ?? usesTauriSecretBackend();
    this.config = loadSearchConfig();
    makeAutoObservable<this,
      'client'
      | 'cache'
      | 'useKeychainSecrets'
      | 'configPersistenceDisposer'
      | 'secretPersistenceDisposer'
    >(this, {
      client: false,
      cache: false,
      useKeychainSecrets: false,
      configPersistenceDisposer: false,
      secretPersistenceDisposer: false,
    });

    if (options.autoPersist ?? true) this.startPersistence();
  }

  startPersistence(): void {
    if (this.configPersistenceDisposer || this.secretPersistenceDisposer) return;
    this.configPersistenceDisposer = autorun(() => {
      saveSearchConfig(searchConfigForLocalPersistence(toJS(this.config), this.useKeychainSecrets));
    });
    this.secretPersistenceDisposer = reaction(
      () => this.config.brave?.apiKey ?? '',
      apiKey => persistSecretValue(SECRET_NAMES.braveApiKey, apiKey, 'Brave Search API key'),
      { fireImmediately: false },
    );
  }

  dispose(): void {
    this.secretPersistenceDisposer?.();
    this.configPersistenceDisposer?.();
    this.secretPersistenceDisposer = null;
    this.configPersistenceDisposer = null;
  }

  hydrateBraveKey(apiKey: string | null | undefined): void {
    this.setBraveKey(apiKey ?? '');
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
    depth?: BraveSearchDepth;
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
      depth: input.depth,
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
        depth: options.depth,
        signal,
      });
      this.setCached(key, sources);
      return { query, ok: true, sources };
    } catch (err) {
      const code = err instanceof BraveSearchError ? err.code : 'search_error';
      logger.warn('search', 'Brave search failed', { query, errorCode: code, err });
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

function searchConfigForLocalPersistence(
  config: SearchPersistedConfig,
  stripSecrets: boolean,
): SearchPersistedConfig {
  if (!stripSecrets) return config;
  const next: SearchPersistedConfig = { ...config };
  if (next.brave?.apiKey) {
    const { apiKey: _, ...rest } = next.brave;
    if (Object.keys(rest).length > 0) next.brave = rest;
    else delete next.brave;
  }
  return next;
}

function persistSecretValue(name: string, value: string, label: string): void {
  const op = value ? setSecret(name, value) : deleteSecret(name);
  void op.catch(err => logger.warn('persistence', `${label} persistence failed`, { err }));
}

function cacheKey(query: string, options: BraveSearchOptions): string {
  return JSON.stringify({
    query: query.trim().replace(/\s+/g, ' ').toLowerCase(),
    freshness: options.freshness ?? '',
    country: (options.country ?? 'US').trim().toUpperCase(),
    searchLang: (options.searchLang ?? 'en').trim().toLowerCase(),
    depth: options.depth ?? 'standard',
  });
}

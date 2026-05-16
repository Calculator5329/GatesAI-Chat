export type BraveFreshness = 'pd' | 'pw' | 'pm' | 'py';

export interface BraveSearchOptions {
  freshness?: BraveFreshness;
  country?: string;
  searchLang?: string;
}

export interface BraveSearchSource {
  title: string;
  url: string;
  text: string;
}

export interface BraveSearchQueryResult {
  query: string;
  ok: boolean;
  sources: BraveSearchSource[];
  errorCode?: string;
  summary?: string;
}

export interface BraveSearchRequest extends BraveSearchOptions {
  query: string;
  signal?: AbortSignal;
}


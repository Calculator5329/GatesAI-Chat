export type BraveFreshness = 'pd' | 'pw' | 'pm' | 'py';
export type BraveSearchDepth = 'standard' | 'deep';

export interface BraveSearchOptions {
  freshness?: BraveFreshness;
  country?: string;
  searchLang?: string;
  depth?: BraveSearchDepth;
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

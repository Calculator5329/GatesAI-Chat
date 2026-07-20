export type LibrarySourceKind = 'document' | 'database';
export type LibrarySourceStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface LibrarySource {
  id: string;
  path: string;
  title: string;
  kind: LibrarySourceKind;
  enabled: boolean;
  addedAt: number;
  status: LibrarySourceStatus;
  updatedAt?: number;
  size?: number;
  error?: string;
}

export interface LibraryDocument {
  id: string;
  path: string;
  title: string;
  kind: LibrarySourceKind;
  text: string;
  updatedAt: number;
}

export interface LibrarySnapshot {
  sources: Array<Pick<LibrarySource, 'id' | 'path' | 'title' | 'kind' | 'enabled' | 'addedAt'>>;
}

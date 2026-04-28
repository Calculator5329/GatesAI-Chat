export interface ArtifactVersion {
  version: number;
  createdAt: number;
  changeNote?: string;
  /** Bytes on disk (UTF-8) — handy for budget displays. */
  size: number;
}

export interface ArtifactMeta {
  id: string;
  title: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  threadId: string;
  originMessageId?: string;
  currentVersion: number;
  versions: ArtifactVersion[];
}

const NANOID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeArtifactId(title: string): string {
  const slug = slugify(title) || 'artifact';
  let suffix = '';
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (const n of arr) suffix += NANOID_ALPHABET[n % NANOID_ALPHABET.length];
  return `${slug.slice(0, 30)}-${suffix}`;
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function artifactDir(id: string): string {
  return `/workspace/artifacts/${id}`;
}
export function artifactMetaPath(id: string): string {
  return `${artifactDir(id)}/meta.json`;
}
export function artifactVersionPath(id: string, version: number): string {
  return `${artifactDir(id)}/v${version}.html`;
}
export function artifactDataDir(id: string): string {
  return `${artifactDir(id)}/data`;
}

/** Validate that a /workspace path stays inside this artifact's data folder. */
export function isArtifactDataPath(id: string, path: string): boolean {
  const norm = normalizeWorkspacePath(path);
  if (!norm) return false;
  if (norm.includes('..')) return false;
  const prefix = `${artifactDataDir(id)}/`;
  return norm === artifactDataDir(id) || norm.startsWith(prefix);
}

function normalizeWorkspacePath(p: string): string | null {
  if (typeof p !== 'string' || !p) return null;
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/workspace')) s = `/workspace/${s.replace(/^\/+/, '')}`;
  // collapse `.` segments but preserve `..` so isArtifactDataPath can reject them
  const parts = s.split('/').filter((seg, i) => seg !== '.' && (i === 0 || seg !== ''));
  return parts.join('/').replace(/\/+/g, '/');
}

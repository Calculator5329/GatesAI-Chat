// Pure domain contract for the versioned HTML artifact registry.

export const HTML_ARTIFACT_REGISTRY_VERSION = 1;
export const HTML_ARTIFACT_ROOT = '/workspace/artifacts/html';
export const HTML_ARTIFACT_INDEX_PATH = `${HTML_ARTIFACT_ROOT}/index.json`;

export interface HtmlArtifactRecord {
  id: string;
  title: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  sizeBytes: number;
}

export interface HtmlArtifactIndex {
  version: typeof HTML_ARTIFACT_REGISTRY_VERSION;
  artifacts: HtmlArtifactRecord[];
}

export function htmlArtifactPath(id: string): string {
  return `${HTML_ARTIFACT_ROOT}/${id}.html`;
}

export function isHtmlArtifactId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value);
}

export function sanitizeHtmlArtifactTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '') || 'artifact';
}

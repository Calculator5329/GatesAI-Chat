// Bridge-backed sidecar registry for HTML artifacts. Files remain portable
// HTML documents; this versioned index makes their identity and revisions
// durable without embedding app metadata into user content.
import {
  HTML_ARTIFACT_INDEX_PATH,
  HTML_ARTIFACT_REGISTRY_VERSION,
  HTML_ARTIFACT_ROOT,
  type HtmlArtifactIndex,
  type HtmlArtifactRecord,
  isHtmlArtifactId,
  sanitizeHtmlArtifactTitle,
} from '../../core/htmlArtifacts';
import type { FsListResp, FsReadResp } from '../../core/workspace';
import type { BridgeClientFacade } from '../tools/types';
import { isRecord } from '../../core/guards';

export async function loadHtmlArtifactIndex(
  client: BridgeClientFacade,
  options: { migrate?: boolean; threadId?: string } = {},
): Promise<HtmlArtifactIndex> {
  let read: FsReadResp;
  try {
    read = await client.request<FsReadResp>('fs.read', {
      path: HTML_ARTIFACT_INDEX_PATH,
      encoding: 'utf8',
    });
  } catch {
    const migrated = await migrateIndexlessFolder(client, options.threadId ?? 'unknown');
    if (options.migrate !== false) await writeHtmlArtifactIndex(client, migrated);
    return migrated;
  }
  return parseHtmlArtifactIndex(read.content);
}

export async function writeHtmlArtifactIndex(
  client: BridgeClientFacade,
  index: HtmlArtifactIndex,
): Promise<void> {
  await client.request('fs.mkdir', { path: HTML_ARTIFACT_ROOT });
  await client.request('fs.write', {
    path: HTML_ARTIFACT_INDEX_PATH,
    content: `${JSON.stringify(index, null, 2)}\n`,
    encoding: 'utf8',
  });
}

export function parseHtmlArtifactIndex(raw: string): HtmlArtifactIndex {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.version !== HTML_ARTIFACT_REGISTRY_VERSION || !Array.isArray(parsed.artifacts)) {
    throw new Error('Unsupported or malformed HTML artifact index.');
  }
  const artifacts = parsed.artifacts.map(parseRecord);
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) throw new Error(`Duplicate HTML artifact id "${artifact.id}".`);
    ids.add(artifact.id);
  }
  return { version: HTML_ARTIFACT_REGISTRY_VERSION, artifacts };
}

export function nextHtmlArtifactId(title: string, records: readonly HtmlArtifactRecord[]): string {
  const slug = sanitizeHtmlArtifactTitle(title);
  const used = new Set(records.map(record => record.id));
  let suffix = 1;
  while (used.has(`${slug}-${suffix}`)) suffix += 1;
  return `${slug}-${suffix}`;
}

async function migrateIndexlessFolder(
  client: BridgeClientFacade,
  threadId: string,
): Promise<HtmlArtifactIndex> {
  let listing: FsListResp;
  try {
    listing = await client.request<FsListResp>('fs.list', { path: HTML_ARTIFACT_ROOT, recursive: false });
  } catch {
    return { version: HTML_ARTIFACT_REGISTRY_VERSION, artifacts: [] };
  }
  const usedIds = new Set<string>();
  const artifacts = (Array.isArray(listing.entries) ? listing.entries : [])
    .filter(entry => entry.kind === 'file' && /\.html?$/i.test(entry.name))
    .map(entry => {
      const rawId = entry.name.replace(/\.html?$/i, '');
      const baseId = isHtmlArtifactId(rawId) ? rawId : sanitizeHtmlArtifactTitle(rawId);
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      const timestamp = safeIso(entry.mtime);
      return {
        id,
        title: titleFromId(id),
        threadId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        sizeBytes: entry.size ?? 0,
      } satisfies HtmlArtifactRecord;
    });
  return { version: HTML_ARTIFACT_REGISTRY_VERSION, artifacts };
}

function parseRecord(value: unknown): HtmlArtifactRecord {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !isHtmlArtifactId(value.id)
    || typeof value.title !== 'string'
    || typeof value.threadId !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || typeof value.revision !== 'number'
    || !Number.isInteger(value.revision)
    || value.revision < 1
    || typeof value.sizeBytes !== 'number'
    || !Number.isFinite(value.sizeBytes)
    || value.sizeBytes < 0
  ) {
    throw new Error('Malformed HTML artifact registry entry.');
  }
  return {
    id: value.id,
    title: value.title,
    threadId: value.threadId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    revision: value.revision,
    sizeBytes: value.sizeBytes,
  };
}


function safeIso(mtime: number): string {
  const value = new Date(mtime);
  return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
}

function titleFromId(id: string): string {
  return id
    .replace(/-\d+$/, '')
    .split('-')
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ') || 'Artifact';
}

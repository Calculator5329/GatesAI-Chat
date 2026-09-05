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
  htmlArtifactPath,
  sanitizeHtmlArtifactTitle,
} from '../../core/htmlArtifacts';
import type { FsEntry, FsListResp, FsReadResp } from '../../core/workspace';
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
    const listing = await observeIndexlessFolder(client);
    const migrated = migrateIndexlessFolder(listing, options.threadId ?? 'unknown');
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
  if (raw.trim() === '') throw new Error('HTML artifact index is empty. Preserve it and restore a valid registry before retrying.');
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


function completeListing(listing: FsListResp, path: string): FsEntry[] {
  const names = new Set<string>();
  if (!isRecord(listing) || (listing.path === '/workspace/.' ? '/workspace' : listing.path) !== path
    || !Array.isArray(listing.entries) || (listing.truncated !== undefined && listing.truncated !== false)) {
    throw new Error('HTML artifact listing is incomplete or malformed; existing files are preserved.');
  }
  for (const entry of listing.entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name
      || entry.name === '.' || entry.name === '..' || /[/\\]/.test(entry.name)
      || entry.path !== `${path}/${entry.name}` || !['file', 'dir'].includes(entry.kind)
      || typeof entry.mtime !== 'number' || !Number.isFinite(entry.mtime)
      || (entry.size !== undefined && (typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0))
      || names.has(entry.name)) {
      throw new Error('HTML artifact listing entries are malformed; existing files are preserved.');
    }
    names.add(entry.name);
  }
  return listing.entries;
}

async function observeIndexlessFolder(client: BridgeClientFacade): Promise<FsEntry[]> {
  let path = HTML_ARTIFACT_ROOT;
  let missingChild: string | undefined;
  while (true) {
    let listing: FsListResp;
    try {
      listing = await client.request<FsListResp>('fs.list', { path, recursive: false });
    } catch (error) {
      if (path === '/workspace') throw error;
      // A failed child read only permits inspecting its parent, never writing.
      missingChild = path.slice(path.lastIndexOf('/') + 1);
      path = path.slice(0, path.lastIndexOf('/'));
      continue;
    }
    const entries = completeListing(listing, path);
    const present = entries.some(entry => entry.name === (missingChild ?? 'index.json'));
    if (present) throw new Error('HTML artifact registry could not be read; its path still exists. Existing files are preserved.');
    return missingChild ? [] : entries;
  }
}

function migrateIndexlessFolder(entries: FsEntry[], threadId: string): HtmlArtifactIndex {
  const artifacts = entries
    .filter(entry => entry.kind === 'file' && /\.html?$/i.test(entry.name))
    .map(entry => {
      const id = entry.name.replace(/\.html?$/i, '');
      if (!isHtmlArtifactId(id) || entry.path !== htmlArtifactPath(id)) {
        throw new Error('Legacy HTML filenames do not match registry IDs. Preserve the files and resolve their names before migrating.');
      }
      const timestamp = safeIso(entry.mtime);
      return {
        id, title: titleFromId(id), threadId, createdAt: timestamp, updatedAt: timestamp,
        revision: 1, sizeBytes: entry.size ?? 0,
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

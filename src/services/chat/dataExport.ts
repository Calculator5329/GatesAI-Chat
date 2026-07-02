import packageJson from '../../../package.json';
import type { NotesSnapshot } from '../../core/notes';
import type { ChatSnapshot, CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey, Thread } from '../../core/types';
import type { UserProfileSnapshot } from '../profileStorage';
import { parseChatSnapshotValue, prepareChatSnapshotForSave } from '../persistence';
import { DEFAULT_UI_PREFS, type UiPrefsSnapshot } from '../uiPrefsStorage';

export const DATA_EXPORT_FORMAT = 'gatesai-chat-export';
export const DATA_EXPORT_FORMAT_VERSION = 1;
export const REPLACE_IMPORT_CONFIRMATION = 'replace all GatesAI data';

export type DataImportMode = 'merge' | 'replace';

export interface GatesAiChatExportData extends ChatSnapshot {
  profile: UserProfileSnapshot;
  notes: NotesSnapshot;
  uiPrefs: UiPrefsSnapshot;
}

export interface GatesAiChatExportEnvelope {
  format: typeof DATA_EXPORT_FORMAT;
  formatVersion: typeof DATA_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  appVersion: string;
  data: GatesAiChatExportData;
}

export interface DataImportResult {
  mode: DataImportMode;
  threadsImported: number;
  threadsSkipped: number;
  memoriesImported: number;
  memoriesSkipped: number;
  notesImported: number;
  notesSkipped: number;
}

export interface DataExportStores {
  chat: {
    snapshot: ChatSnapshot;
    applyImportedSnapshot(snapshot: ChatSnapshot): void;
  };
  profile: {
    snapshot: UserProfileSnapshot;
    applyImportedProfile(snapshot: UserProfileSnapshot): void;
    mergeImportedProfile(snapshot: UserProfileSnapshot): { imported: number; skipped: number };
  };
  notes: {
    snapshot: NotesSnapshot;
    applyImportedNotes(snapshot: NotesSnapshot): void;
    mergeImportedNotes(snapshot: NotesSnapshot): { imported: number; skipped: number };
  };
  ui: {
    prefsSnapshot: UiPrefsSnapshot;
    applyImportedPrefs(snapshot: UiPrefsSnapshot): void;
  };
}

export class DataImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataImportError';
  }
}

const KNOWN_SECRET_FIELD_NAMES = new Set([
  'apiKey',
  'apiKeys',
  'openrouterApiKey',
  'openRouterApiKey',
  'openrouterKey',
  'openRouterKey',
]);

const MARKDOWN_STYLES = new Set<MarkdownStyleKey>(['editorial', 'technical', 'compact']);
const CODE_STYLES = new Set<CodeStyleKey>(['obsidian', 'terminal', 'paper']);
const MARKDOWN_DENSITIES = new Set<MarkdownDensityKey>(['compact', 'comfortable', 'spacious']);
const CODE_SIZES = new Set<CodeSizeKey>(['small', 'medium', 'large']);

export function createDataExportEnvelope(
  stores: DataExportStores,
  exportedAt = new Date(),
): GatesAiChatExportEnvelope {
  const chatSnapshot = prepareChatSnapshotForSave(cloneJson(stores.chat.snapshot));
  const data = stripKnownSecretFields({
    ...chatSnapshot,
    profile: cloneJson(stores.profile.snapshot),
    notes: cloneJson(stores.notes.snapshot),
    uiPrefs: cloneJson(stores.ui.prefsSnapshot),
  }) as GatesAiChatExportData;

  return {
    format: DATA_EXPORT_FORMAT,
    formatVersion: DATA_EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    appVersion: packageJson.version,
    data,
  };
}

export function serializeDataExport(
  stores: DataExportStores,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(createDataExportEnvelope(stores, exportedAt), null, 2)}\n`;
}

export function downloadDataExport(stores: DataExportStores, exportedAt = new Date()): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Downloads are only available in a browser window.');
  }
  const blob = new Blob([serializeDataExport(stores, exportedAt)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gatesai-export-${exportedAt.toISOString().slice(0, 10)}.json`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function parseDataExportJson(raw: string): GatesAiChatExportEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataImportError('Could not read export file: malformed JSON.');
  }
  return parseDataExportEnvelope(parsed);
}

export function importDataFromJson(
  stores: DataExportStores,
  raw: string,
  mode: DataImportMode,
): DataImportResult {
  const envelope = parseDataExportJson(raw);
  return applyDataImport(stores, envelope, mode);
}

export function applyDataImport(
  stores: DataExportStores,
  envelope: GatesAiChatExportEnvelope,
  mode: DataImportMode,
): DataImportResult {
  const data = cloneJson(envelope.data);
  if (mode === 'replace') {
    stores.chat.applyImportedSnapshot(chatSnapshotFromData(data));
    stores.profile.applyImportedProfile(data.profile);
    stores.notes.applyImportedNotes(data.notes);
    stores.ui.applyImportedPrefs(data.uiPrefs);
    return {
      mode,
      threadsImported: data.threads.length,
      threadsSkipped: 0,
      memoriesImported: factsFromBio(data.profile.bio).length,
      memoriesSkipped: 0,
      notesImported: data.notes.notes.length,
      notesSkipped: 0,
    };
  }

  const chatMerge = mergeChatSnapshots(stores.chat.snapshot, chatSnapshotFromData(data));
  stores.chat.applyImportedSnapshot(chatMerge.snapshot);
  const memoryMerge = stores.profile.mergeImportedProfile(data.profile);
  const notesMerge = stores.notes.mergeImportedNotes(data.notes);
  stores.ui.applyImportedPrefs(data.uiPrefs);
  return {
    mode,
    threadsImported: chatMerge.imported,
    threadsSkipped: chatMerge.skipped,
    memoriesImported: memoryMerge.imported,
    memoriesSkipped: memoryMerge.skipped,
    notesImported: notesMerge.imported,
    notesSkipped: notesMerge.skipped,
  };
}

export function formatDataImportResult(result: DataImportResult): string {
  const parts = [`Imported ${plural(result.threadsImported, 'thread')}`];
  if (result.threadsSkipped > 0) parts.push(`${plural(result.threadsSkipped, 'thread')} skipped as duplicates`);
  if (result.memoriesImported > 0) parts.push(`${plural(result.memoriesImported, 'memory')}`);
  if (result.memoriesSkipped > 0) parts.push(`${plural(result.memoriesSkipped, 'memory')} skipped`);
  if (result.notesImported > 0) parts.push(`${plural(result.notesImported, 'note')}`);
  if (result.notesSkipped > 0) parts.push(`${plural(result.notesSkipped, 'note')} skipped`);
  return `${parts.join(', ')}.`;
}

function parseDataExportEnvelope(value: unknown): GatesAiChatExportEnvelope {
  if (!isRecord(value)) throw new DataImportError('Export file is not a GatesAI chat export.');
  if (value.format !== DATA_EXPORT_FORMAT) {
    throw new DataImportError(`Unsupported export format. Expected "${DATA_EXPORT_FORMAT}".`);
  }
  if (value.formatVersion !== DATA_EXPORT_FORMAT_VERSION) {
    throw new DataImportError(`Unsupported export version. Expected version ${DATA_EXPORT_FORMAT_VERSION}.`);
  }
  const data = parseExportData(value.data);
  return {
    format: DATA_EXPORT_FORMAT,
    formatVersion: DATA_EXPORT_FORMAT_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : '',
    data,
  };
}

function parseExportData(value: unknown): GatesAiChatExportData {
  if (!isRecord(value)) throw new DataImportError('Export file has no data section.');
  const chat = parseChatSnapshotValue({
    threads: value.threads,
    activeThreadId: value.activeThreadId,
  });
  if (!chat) throw new DataImportError('Export file has invalid chat data.');
  return {
    ...chat,
    profile: parseProfileSnapshot(value.profile),
    notes: parseNotesSnapshot(value.notes),
    uiPrefs: parseUiPrefsSnapshot(value.uiPrefs),
  };
}

function parseProfileSnapshot(value: unknown): UserProfileSnapshot {
  if (!isRecord(value)) return { bio: '', defaultSystemPrompt: '' };
  return {
    bio: typeof value.bio === 'string' ? value.bio : '',
    defaultSystemPrompt: typeof value.defaultSystemPrompt === 'string' ? value.defaultSystemPrompt : '',
  };
}

function parseNotesSnapshot(value: unknown): NotesSnapshot {
  if (!isRecord(value)) return { notes: [] };
  if (!Array.isArray(value.notes)) return { notes: [] };
  const notes = value.notes.map(parseNote).filter((note): note is NotesSnapshot['notes'][number] => note !== null);
  return { notes };
}

function parseNote(value: unknown): NotesSnapshot['notes'][number] | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const title = stringField(value.title);
  const body = stringField(value.body);
  const createdAt = numberField(value.createdAt);
  const updatedAt = numberField(value.updatedAt);
  if (!id || title === undefined || body === undefined || createdAt === undefined || updatedAt === undefined) return null;
  const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined;
  return {
    id,
    title,
    body,
    ...(tags && tags.length > 0 ? { tags } : {}),
    createdAt,
    updatedAt,
  };
}

function parseUiPrefsSnapshot(value: unknown): UiPrefsSnapshot {
  const r = isRecord(value) ? value : {};
  return {
    markdownStyle: memberOrDefault(r.markdownStyle, MARKDOWN_STYLES, DEFAULT_UI_PREFS.markdownStyle),
    codeStyle: memberOrDefault(r.codeStyle, CODE_STYLES, DEFAULT_UI_PREFS.codeStyle),
    markdownDensity: memberOrDefault(r.markdownDensity, MARKDOWN_DENSITIES, DEFAULT_UI_PREFS.markdownDensity),
    codeSize: memberOrDefault(r.codeSize, CODE_SIZES, DEFAULT_UI_PREFS.codeSize),
    bodyFontSizePx: numberOrDefault(r.bodyFontSizePx, DEFAULT_UI_PREFS.bodyFontSizePx),
    readingWidthPx: numberOrDefault(r.readingWidthPx, DEFAULT_UI_PREFS.readingWidthPx),
    animationsEnabled: typeof r.animationsEnabled === 'boolean'
      ? r.animationsEnabled
      : DEFAULT_UI_PREFS.animationsEnabled,
  };
}

function mergeChatSnapshots(
  current: ChatSnapshot,
  incoming: ChatSnapshot,
): { snapshot: ChatSnapshot; imported: number; skipped: number } {
  const currentIsPlaceholder = isEmptyPlaceholderSnapshot(current);
  const baseThreads = currentIsPlaceholder ? [] : cloneJson(current.threads);
  const existingIds = new Set(baseThreads.map(thread => thread.id));
  const importedThreads: Thread[] = [];
  let skipped = 0;
  for (const thread of incoming.threads) {
    if (existingIds.has(thread.id)) {
      skipped += 1;
      continue;
    }
    const next = cloneJson(thread);
    existingIds.add(next.id);
    importedThreads.push(next);
  }

  const threads = [...baseThreads, ...importedThreads];
  const currentActive = !currentIsPlaceholder
    && current.activeThreadId
    && threads.some(thread => thread.id === current.activeThreadId)
    ? current.activeThreadId
    : null;
  const incomingActive = incoming.activeThreadId
    && importedThreads.some(thread => thread.id === incoming.activeThreadId)
    ? incoming.activeThreadId
    : null;
  return {
    snapshot: {
      threads,
      activeThreadId: currentActive ?? incomingActive ?? importedThreads[0]?.id ?? current.activeThreadId,
    },
    imported: importedThreads.length,
    skipped,
  };
}

function isEmptyPlaceholderSnapshot(snapshot: ChatSnapshot): boolean {
  if (snapshot.threads.length !== 1) return false;
  const thread = snapshot.threads[0];
  return thread.title === 'New conversation'
    && thread.subtitle === ''
    && thread.messages.length === 0
    && !thread.pinned
    && thread.deletedAt == null
    && !thread.threadContext
    && !thread.summary;
}

function chatSnapshotFromData(data: GatesAiChatExportData): ChatSnapshot {
  return {
    threads: data.threads,
    activeThreadId: data.activeThreadId,
  };
}

function stripKnownSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKnownSecretFields);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !KNOWN_SECRET_FIELD_NAMES.has(key))
      .map(([key, item]) => [key, stripKnownSecretFields(item)]),
  );
}

function factsFromBio(bio: string): string[] {
  return bio
    .split('\n')
    .map(line => line.trim().replace(/^[\u00b7\-*\u2022]\s*/, '').trim())
    .filter(Boolean);
}

function plural(count: number, singular: string): string {
  if (singular === 'memory') return `${count} ${count === 1 ? 'memory' : 'memories'}`;
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function memberOrDefault<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

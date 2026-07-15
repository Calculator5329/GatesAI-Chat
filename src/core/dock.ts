// Pure types + helpers for the right dock panel framework (W-1).
// Shared by stores/DockStore, services/storage/dockStorage, and the dock
// components; kept dependency-free per core/ layer rules.

/** Panel kinds the dock can host in v1 (Slice 1+2: read-only viewers). */
export type DockPanelKind = 'file-viewer' | 'file-explorer' | 'media-viewer' | 'offline-library';

export interface DockPanelRef {
  kind: DockPanelKind;
  params: { path?: string };
}

/** One column, up to two stacked cells. */
export type DockCells = [DockPanelRef | null, DockPanelRef | null];

export interface DockSnapshot {
  version: number;
  cells: DockCells;
  /** Fraction of the dock's height the first cell takes when both are occupied. */
  splitRatio: number;
  /** Fraction of the app width the dock column takes. */
  dockRatio: number;
  collapsed: boolean;
}

export const DOCK_SNAPSHOT_VERSION = 1;

export const DOCK_MIN_SPLIT_RATIO = 0.15;
export const DOCK_MAX_SPLIT_RATIO = 0.85;
export const DOCK_MIN_DOCK_RATIO = 0.18;
export const DOCK_MAX_DOCK_RATIO = 0.6;

export const DEFAULT_DOCK_SNAPSHOT: DockSnapshot = {
  version: DOCK_SNAPSHOT_VERSION,
  cells: [null, null],
  splitRatio: 0.5,
  dockRatio: 0.32,
  collapsed: false,
};

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOCK_SNAPSHOT.splitRatio;
  return Math.min(DOCK_MAX_SPLIT_RATIO, Math.max(DOCK_MIN_SPLIT_RATIO, value));
}

export function clampDockRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOCK_SNAPSHOT.dockRatio;
  return Math.min(DOCK_MAX_DOCK_RATIO, Math.max(DOCK_MIN_DOCK_RATIO, value));
}

export function isDockPanelKind(value: unknown): value is DockPanelKind {
  return value === 'file-viewer'
    || value === 'file-explorer'
    || value === 'media-viewer'
    || value === 'offline-library';
}

/** Content categories the read-only viewer panels distinguish between. */
export type DockFileKind =
  | 'markdown'
  | 'json'
  | 'html'
  | 'text'
  | 'image'
  | 'video'
  | 'audio';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];

function fileExtension(path: string): string {
  const clean = path.trim().split(/[?#]/, 1)[0] ?? '';
  const name = clean.split('/').filter(Boolean).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Classify a path into the content category a dock panel should render. */
export function classifyDockFile(path: string): DockFileKind {
  const ext = fileExtension(path);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return 'text';
}

/** Which panel kind should host `path` (media files → media viewer). */
export function dockPanelKindForPath(path: string): DockPanelKind {
  const kind = classifyDockFile(path);
  return kind === 'image' || kind === 'video' || kind === 'audio'
    ? 'media-viewer'
    : 'file-viewer';
}

export function dockFileName(path: string): string {
  const clean = path.trim().split(/[?#]/, 1)[0] ?? path;
  return clean.split('/').filter(Boolean).pop() || path;
}

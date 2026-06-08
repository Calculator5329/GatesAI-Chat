// Single source of truth for where the desktop app is distributed and which
// build fits a given client platform. Lives in core/ (pure data, no imports) so
// UI, stores, and the chat runtime context can all agree on the same URLs.
//
// The desktop installers are published as GitHub Release assets. The
// `releases/latest/download/<asset>` form is a stable redirect to the newest
// release's asset, so these links keep working across versions — they 404 only
// until the first release exists.
import type { ClientArch, ClientOs } from './clientPlatform';

const REPO_URL = 'https://github.com/Calculator5329/GatesAI-Chat';

/** Public distribution links. Asset names are fixed by the release workflow. */
export const downloadLinks = {
  repo: REPO_URL,
  releases: `${REPO_URL}/releases/latest`,
  windowsExe: `${REPO_URL}/releases/latest/download/GatesAI-Chat-Setup-x64.exe`,
  linuxAppImage: `${REPO_URL}/releases/latest/download/GatesAI-Chat-x86_64.AppImage`,
} as const;

export type DownloadKind = 'windows-exe' | 'linux-appimage' | 'source';

export interface DownloadRecommendation {
  kind: DownloadKind;
  /** Where the download/instructions live. */
  url: string;
  /** Short call-to-action label, e.g. "Download for Windows (64-bit)". */
  label: string;
  /** What the artifact runs on, stated plainly for the user/model. */
  runsOn: string;
  /** Optional caveat (e.g. ARM emulation) worth surfacing. */
  note?: string;
}

/**
 * Pick the best desktop download for a detected client platform.
 * - Windows  → the x64 NSIS installer (runs on ARM via emulation, noted).
 * - Linux x64 → the AppImage.
 * - macOS / unknown / Linux-non-x64 → build from source (repo).
 */
export function recommendedDownload(os: ClientOs, arch: ClientArch): DownloadRecommendation {
  if (os === 'windows') {
    return {
      kind: 'windows-exe',
      url: downloadLinks.windowsExe,
      label: 'Download for Windows (64-bit)',
      runsOn: 'Windows 10/11, 64-bit (x64)',
      note: arch === 'arm64'
        ? 'Your device looks like Windows on ARM — the x64 installer runs via built-in emulation.'
        : undefined,
    };
  }
  if (os === 'linux' && arch !== 'arm64') {
    return {
      kind: 'linux-appimage',
      url: downloadLinks.linuxAppImage,
      label: 'Download for Linux (AppImage)',
      runsOn: 'Linux x86_64 (AppImage)',
    };
  }
  return {
    kind: 'source',
    url: downloadLinks.repo,
    label: 'Get it on GitHub',
    runsOn: os === 'macos'
      ? 'macOS — no prebuilt binary yet; build from source'
      : 'Build from source (Node + Rust/Tauri + Go bridge)',
  };
}

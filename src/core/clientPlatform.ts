// Browser-side detection of the user's OS and CPU architecture, used to
// recommend the right desktop build from Web Lite. Lives in core/ (reads only
// the `navigator` browser global, imports nothing) so any layer can ask.
//
// OS is detected synchronously. Architecture is only available asynchronously
// via the User-Agent Client Hints high-entropy API, so callers should fire
// `primeClientPlatform()` once at startup; until it resolves we assume x64 on
// Windows/Linux (the overwhelmingly common case), which is also the build we ship.

export type ClientOs = 'windows' | 'macos' | 'linux' | 'other';
export type ClientArch = 'x64' | 'arm64' | 'unknown';

// Minimal shape of the User-Agent Client Hints API (not in the DOM lib types).
interface UADataValues {
  architecture?: string;
  bitness?: string;
}
interface NavigatorUAData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<UADataValues>;
}

function uaData(): NavigatorUAData | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
}

/** Detect the client OS synchronously from Client Hints, platform, or UA string. */
export function detectClientOs(): ClientOs {
  if (typeof navigator === 'undefined') return 'other';
  const hint = uaData()?.platform ?? '';
  const legacy = navigator.platform ?? '';
  const ua = navigator.userAgent ?? '';
  const haystack = `${hint} ${legacy} ${ua}`.toLowerCase();
  if (haystack.includes('win')) return 'windows';
  // Check iOS/Android-ish first so "mac" doesn't swallow them; we only ship
  // desktop builds, so mobile collapses into "other" via the fallthrough.
  if (/android|iphone|ipad|ipod/.test(haystack)) return 'other';
  if (haystack.includes('mac')) return 'macos';
  if (haystack.includes('linux') || haystack.includes('x11')) return 'linux';
  return 'other';
}

// Resolved architecture, cached after priming. Defaults to 'unknown' until then;
// `clientArch()` upgrades that to a sensible per-OS assumption.
let resolvedArch: ClientArch = 'unknown';

function normalizeArch(values: UADataValues): ClientArch {
  const arch = (values.architecture ?? '').toLowerCase();
  if (arch === 'arm' || arch.includes('arm64') || arch === 'aarch64') return 'arm64';
  // Client Hints report Intel/AMD as "x86"; bitness distinguishes 32 vs 64.
  // We only ship x64, so treat 64-bit (or unspecified) x86 as x64.
  if (arch === 'x86') return values.bitness === '32' ? 'unknown' : 'x64';
  return 'unknown';
}

/**
 * Resolve and cache the CPU architecture via high-entropy Client Hints.
 * Safe to call repeatedly; never throws. No-op where the API is unavailable.
 */
export async function primeClientPlatform(): Promise<void> {
  const data = uaData();
  if (!data?.getHighEntropyValues) return;
  try {
    const values = await data.getHighEntropyValues(['architecture', 'bitness']);
    resolvedArch = normalizeArch(values);
  } catch {
    // Permissions or unsupported hint — leave the assumed default in place.
  }
}

/** Best-known architecture. Falls back to x64 on desktop OSes when unresolved. */
export function clientArch(): ClientArch {
  if (resolvedArch !== 'unknown') return resolvedArch;
  const os = detectClientOs();
  return os === 'windows' || os === 'linux' ? 'x64' : 'unknown';
}

export interface ClientPlatform {
  os: ClientOs;
  arch: ClientArch;
  /** Human-readable summary, e.g. "windows / x64". */
  label: string;
}

export function clientPlatform(): ClientPlatform {
  const os = detectClientOs();
  const arch = clientArch();
  return { os, arch, label: `${os} / ${arch}` };
}

/** Test-only: reset cached architecture between cases. */
export function __resetClientPlatformForTests(): void {
  resolvedArch = 'unknown';
}

// Manages local-runtime discovery, process control, or persistence for autoDetect.
// Called by LocalRuntimeStore and menu controls; depends on bridge/system APIs and runtime ids.
// Invariant: runtime state is stored separately from detection/probe side effects.
import type { LocalRuntimeId } from './localRuntimeService';
import { localRuntimeService } from './localRuntimeService';

export interface DetectedRuntime {
  installPath: string;
}

export type LocalRuntimeDetection = Partial<Record<LocalRuntimeId, DetectedRuntime>>;

export interface AutoDetectOptions {
  platform?: string;
  homeDir?: string;
  localAppData?: string;
  comfyCandidates?: string[];
  pathExists?: (path: string) => Promise<boolean>;
}

export async function detectLocalRuntimes(options: AutoDetectOptions = {}): Promise<LocalRuntimeDetection> {
  const hostCandidates = options.homeDir ? null : await localRuntimeService.getCandidatePaths();
  const platform = options.platform ?? hostCandidates?.platform ?? guessPlatform();
  const homeDir = options.homeDir ?? hostCandidates?.homeDir ?? '';
  const localAppData = options.localAppData ?? hostCandidates?.localAppData ?? guessLocalAppData(homeDir);
  const pathExists = options.pathExists ?? localRuntimeService.pathExists;
  const out: LocalRuntimeDetection = {};

  const ollama = await firstExisting(ollamaCandidates(platform, homeDir, localAppData), pathExists);
  if (ollama) out.ollama = { installPath: ollama };

  const comfy = await firstComfyRoot(options.comfyCandidates ?? hostCandidates?.comfyCandidates ?? comfyRootCandidates(platform, homeDir), pathExists);
  if (comfy) out.comfyui = { installPath: comfy };

  return out;
}

function ollamaCandidates(platform: string, homeDir: string, localAppData: string): string[] {
  if (platform === 'win32' || platform === 'windows') {
    return [
      joinWin(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      joinWin(homeDir, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    ];
  }
  return ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'];
}

function comfyRootCandidates(platform: string, homeDir: string): string[] {
  if (platform === 'win32' || platform === 'windows') {
    return [
      joinWin(homeDir, 'ComfyUI_windows_portable'),
      joinWin(homeDir, 'ComfyUI', 'ComfyUI_windows_portable'),
      joinWin(homeDir, 'Downloads', 'ComfyUI_windows_portable'),
      joinWin(homeDir, 'Downloads', 'ComfyUI_fresh', 'ComfyUI_windows_portable'),
      joinWin(homeDir, 'Desktop', 'ComfyUI_windows_portable'),
      joinWin(homeDir, 'Desktop', 'ComfyUI_fresh', 'ComfyUI_windows_portable'),
    ];
  }
  return [
    `${homeDir}/ComfyUI`,
    `${homeDir}/Downloads/ComfyUI`,
  ];
}

async function firstComfyRoot(candidates: string[], pathExists: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const candidate of candidates) {
    const roots = candidate.endsWith('ComfyUI_windows_portable')
      ? [candidate]
      : [joinWin(candidate, 'ComfyUI_windows_portable'), candidate];
    for (const root of roots) {
      const python = root.includes('\\')
        ? joinWin(root, 'python_embeded', 'python.exe')
        : `${root}/python_embeded/python`;
      const main = root.includes('\\')
        ? joinWin(root, 'ComfyUI', 'main.py')
        : `${root}/main.py`;
      if (await pathExists(python) && await pathExists(main)) return root;
    }
  }
  return null;
}

async function firstExisting(candidates: string[], pathExists: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const path of candidates) {
    if (await pathExists(path)) return path;
  }
  return null;
}

function guessPlatform(): string {
  if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')) return 'win32';
  return 'unknown';
}

function guessLocalAppData(homeDir: string): string {
  return homeDir ? joinWin(homeDir, 'AppData', 'Local') : '';
}

function joinWin(...parts: string[]): string {
  return parts.filter(Boolean).join('\\').replace(/\\+/g, '\\');
}

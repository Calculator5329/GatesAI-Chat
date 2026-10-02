import type { LocalRuntimeId } from './localRuntimeService';

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export function detectDesktopPlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform): DesktopPlatform {
  const normalized = platform.toLowerCase();
  if (normalized.includes('win')) return 'windows';
  if (normalized.includes('mac')) return 'macos';
  return 'linux';
}

export function runtimeInstallPlaceholder(id: LocalRuntimeId, platform = detectDesktopPlatform()): string {
  if (platform === 'windows') {
    return id === 'ollama'
      ? 'C:\\Users\\you\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
      : 'C:\\Users\\you\\ComfyUI\\ComfyUI_windows_portable';
  }
  if (platform === 'macos') {
    return id === 'ollama' ? '/usr/local/bin/ollama' : '/Users/you/ComfyUI';
  }
  return id === 'ollama' ? '/usr/bin/ollama' : '/home/you/ComfyUI';
}

export function ollamaExecutableName(platform = detectDesktopPlatform()): string {
  return platform === 'windows' ? 'ollama.exe' : 'ollama';
}

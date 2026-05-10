export type GatesRuntimeMode = 'desktop' | 'web-lite';

export function isTauri(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

export function runtimeMode(): GatesRuntimeMode {
  return import.meta.env.VITE_GATESAI_WEB === '1' ? 'web-lite' : 'desktop';
}

export function isWebLite(): boolean {
  return runtimeMode() === 'web-lite';
}


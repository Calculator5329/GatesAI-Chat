// Pure runtime-mode detection (desktop Tauri shell vs browser Web Lite).
// Lives in core/ so every layer may read the platform mode without crossing
// the UI -> store -> service boundary. No side effects, no app state.
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

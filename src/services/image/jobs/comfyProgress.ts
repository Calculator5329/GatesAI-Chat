// Defines image-job comfyProgress contracts and progress adapters shared by stores and backends.
// Called by ImageJobStore and image backend clients; depends on image job status and ComfyUI payload shapes.
// Invariant: progress updates are advisory while terminal job status remains authoritative.
import type { JobProgress, ProgressEvent } from './progress';
import { logger } from '../../diagnostics/logger';
import { localFetch } from '../../local/localHttp';

export interface ComfyProgressOptions {
  baseUrl: string;
  clientId: string;
  /** Injectable for tests; defaults to `localFetch`, so `/interrupt` reaches a ComfyUI started without CORS. */
  fetch?: typeof localFetch;
}

interface ComfyFrame {
  type?: string;
  data?: { value?: number; max?: number };
}

export function createComfyProgress(opts: ComfyProgressOptions): JobProgress {
  const fetchImpl = opts.fetch ?? localFetch;
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const wsUrl = trimmed.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(opts.clientId)}`;
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;
  let ws: WebSocket | null = null;

  // The socket stays in the webview, so step progress needs ComfyUI's
  // --enable-cors-header; without it the handshake is refused and images
  // still arrive through ComfyClient's /history polling.
  // `new WebSocket(url)` throws synchronously on malformed URLs, so a
  // failed construction only leaves progress silent.
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    logger.warn('comfy-progress', 'WebSocket construction failed; progress events will be silent.', err);
  }

  if (ws) {
    ws.onmessage = (ev: MessageEvent) => {
      if (disposed) return;
      // ComfyUI sends mixed text + binary frames (binary frames carry
      // preview thumbnails we don't render). JSON.parse on a non-string
      // returns silently via the catch.
      let frame: ComfyFrame;
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (frame.type !== 'progress') return;
      const value = frame.data?.value;
      const max = frame.data?.max;
      if (typeof value !== 'number' || typeof max !== 'number') return;
      for (const fn of listeners) {
        try {
          fn({ value, max });
        } catch (err) {
          // A bad listener must never propagate into the WebSocket
          // event loop — the browser surfaces uncaught WS errors as
          // unhandled errors on `window`, which can destabilize the
          // renderer in some webview hosts.
          logger.warn('comfy-progress', 'listener threw; ignoring.', err);
        }
      }
    };

    // `error` fires on a refused handshake or a mid-stream failure. With no
    // handler some webviews bubble it to `window.onerror`. A refused socket
    // is the normal case without --enable-cors-header, so it logs at info
    // and stays out of the error trail.
    ws.onerror = () => {
      if (disposed) return;
      logger.info('comfy-progress', `No progress socket at ${wsUrl}; step progress needs ComfyUI started with --enable-cors-header. The image still arrives.`);
    };

    ws.onclose = (ev) => {
      if (disposed) return;
      // Render keeps going via HTTP polling in `comfyClient`; we just
      // stop emitting progress events. No state mutation needed.
      if (!ev.wasClean) {
        logger.info('comfy-progress', `Progress socket closed (code ${ev.code}); progress events stop, the render continues.`);
      }
    };
  }

  return {
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => { listeners.delete(onEvent); };
    },
    async cancel() {
      try {
        await fetchImpl(`${trimmed}/interrupt`, { method: 'POST' });
      } catch {
        // best-effort; the abort signal in the runner handles the rest
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { ws?.close(); } catch { /* ignore */ }
      listeners.clear();
    },
  };
}

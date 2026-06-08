// Defines image-job comfyProgress contracts and progress adapters shared by stores and backends.
// Called by ImageJobStore and image backend clients; depends on image job status and ComfyUI payload shapes.
// Invariant: progress updates are advisory while terminal job status remains authoritative.
import type { JobProgress, ProgressEvent } from './progress';
import { logger } from '../../diagnostics/logger';

export interface ComfyProgressOptions {
  baseUrl: string;
  clientId: string;
  /** Optional injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

interface ComfyFrame {
  type?: string;
  data?: { value?: number; max?: number };
}

export function createComfyProgress(opts: ComfyProgressOptions): JobProgress {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const wsUrl = trimmed.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(opts.clientId)}`;
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;
  let ws: WebSocket | null = null;

  // Construct the WebSocket inside a try/catch — `new WebSocket(url)`
  // throws synchronously on malformed URLs and we don't want that to
  // surface as an uncaught renderer error during a job dispatch. If
  // construction fails, progress just stays silent (HTTP polling in
  // `comfyClient.waitForImage` still drives the actual render).
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

    // The `error` event on a WebSocket is fired on connect failure or
    // mid-stream socket errors. With no handler, browsers log it as
    // "WebSocket connection to '...' failed: ..." and (in some
    // webviews) bubble it to `window.onerror`. Attach a no-op-ish
    // handler so the event is consumed cleanly.
    ws.onerror = (ev) => {
      if (disposed) return;
      logger.warn('comfy-progress', `WebSocket error for ${wsUrl}`, ev);
    };

    ws.onclose = (ev) => {
      if (disposed) return;
      // Render keeps going via HTTP polling in `comfyClient`; we just
      // stop emitting progress events. No state mutation needed.
      if (!ev.wasClean) {
        logger.warn('comfy-progress', `WebSocket closed unexpectedly (code ${ev.code}); progress events will stop.`);
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

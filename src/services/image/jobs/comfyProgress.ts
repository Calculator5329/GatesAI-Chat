import type { JobProgress, ProgressEvent } from './progress';

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
  const ws = new WebSocket(wsUrl);
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;

  ws.onmessage = (ev: MessageEvent) => {
    if (disposed) return;
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
    for (const fn of listeners) fn({ value, max });
  };

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
      try { ws.close(); } catch { /* ignore */ }
      listeners.clear();
    },
  };
}

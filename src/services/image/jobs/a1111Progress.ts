import type { JobProgress, ProgressEvent } from './progress';

export interface A1111ProgressOptions {
  baseUrl: string;
  apiKey?: string;
  intervalMs?: number;
  fetch?: typeof fetch;
}

interface A1111ProgressResp { progress?: number; eta_relative?: number }

export function createA1111Progress(opts: A1111ProgressOptions): JobProgress {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const interval = opts.intervalMs ?? 500;
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (disposed) return;
    try {
      const resp = await fetchImpl(`${trimmed}/sdapi/v1/progress?skip_current_image=true`, { headers });
      if (!resp.ok) return;
      const json = (await resp.json()) as A1111ProgressResp;
      const p = json.progress;
      if (typeof p !== 'number' || disposed) return;
      const value = Math.max(0, Math.min(1, p));
      for (const fn of listeners) fn({ value: Math.round(value * 100), max: 100 });
    } catch {
      // ignore — progress is best-effort
    }
  };
  timer = setInterval(() => { void tick(); }, interval);

  return {
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => { listeners.delete(onEvent); };
    },
    async cancel() {
      try {
        await fetchImpl(`${trimmed}/sdapi/v1/interrupt`, { method: 'POST', headers });
      } catch { /* ignore */ }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) { clearInterval(timer); timer = null; }
      listeners.clear();
    },
  };
}

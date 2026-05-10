import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRuntimeStore, STARTING_WATCHDOG_MS } from '../../src/stores/LocalRuntimeStore';
import { clearAppStorage } from '../helpers/storage';

describe('LocalRuntimeStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    clearAppStorage();
    vi.restoreAllMocks();
  });

  it('ignores legacy URL fields on the Ollama / image-gen storage keys', () => {
    localStorage.setItem('gatesai.ollama.v1', JSON.stringify({
      baseUrl: 'http://10.0.0.12:11434',
      toolsEnabled: true,
      catalog: [],
      lastRefreshAt: null,
    }));
    localStorage.setItem('gatesai.imagegen.v1', JSON.stringify({
      backend: 'local-comfy',
      comfyBaseUrl: 'http://10.0.0.13:8188',
    }));

    const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service: fakeService() });

    expect(store.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(store.comfyBaseUrl).toBe('http://127.0.0.1:8188');
  });

  it('starts a runtime, polls it online, and exposes logs from status', async () => {
    const service = fakeService({
      startRuntime: vi.fn(async () => undefined),
      getRuntimeStatus: vi.fn(async () => ({
        running: true,
        pid: 42,
        uptimeMs: 100,
        status: 'online' as const,
        logs: ['ready'],
      })),
    });
    const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
    store.setInstallPath('ollama', 'C:\\Ollama\\ollama.exe');

    await store.start('ollama');

    expect(service.startRuntime).toHaveBeenCalledWith('ollama', {
      installPath: 'C:\\Ollama\\ollama.exe',
    });
    expect(store.runtimes.ollama.status).toBe('online');
    expect(store.runtimes.ollama.pid).toBe(42);
    expect(store.runtimes.ollama.logs).toEqual(['ready']);
  });

  it('treats an address-in-use start error as online when the existing server responds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"version":"0.12.0"}', { status: 200 }),
    );
    const service = fakeService({
      startRuntime: vi.fn(async () => {
        throw new Error('listen tcp 127.0.0.1:11434: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted');
      }),
      probeHttp: vi.fn(async () => undefined),
    });
    const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
    store.setInstallPath('ollama', 'C:\\Ollama\\ollama.exe');

    await store.start('ollama');

    expect(store.runtimes.ollama.status).toBe('online');
    expect(store.runtimes.ollama.lastError).toContain('already running');
    expect(store.runtimes.ollama.lastError).toContain('127.0.0.1:11434');
  });

  it('keeps an address-in-use start error as crashed when the existing server does not respond', async () => {
    const service = fakeService({
      startRuntime: vi.fn(async () => {
        throw new Error('bind: address already in use');
      }),
      probeHttp: vi.fn(async () => { throw new Error('connection refused'); }),
    });
    const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
    store.setInstallPath('ollama', 'C:\\Ollama\\ollama.exe');

    await store.start('ollama');

    expect(store.runtimes.ollama.status).toBe('crashed');
    expect(store.runtimes.ollama.lastError).toBe('bind: address already in use');
  });

  it('auto-detect stores discovered install paths without duplicating runtime state', async () => {
    const store = new LocalRuntimeStore({
      autoDetect: async () => ({
        ollama: { installPath: 'C:\\Ollama\\ollama.exe' },
        comfyui: { installPath: 'C:\\ComfyUI_windows_portable' },
      }),
      service: fakeService(),
    });

    await store.autoDetect();

    expect(store.runtimes.ollama.installPath).toBe('C:\\Ollama\\ollama.exe');
    expect(store.runtimes.comfyui.installPath).toBe('C:\\ComfyUI_windows_portable');
    expect(store.runtimes.ollama.status).toBe('stopped');
  });

  it('only treats ComfyUI as ready when it is managed and online', async () => {
    const store = new LocalRuntimeStore({
      autoDetect: async () => ({}),
      service: fakeService({
        getRuntimeStatus: vi.fn(async () => ({ running: true, status: 'online' as const, logs: [] })),
      }),
    });

    expect(store.comfyReady).toBe(false);
    await store.refreshStatus('comfyui');
    expect(store.comfyReady).toBe(true);
    store.setManaged('comfyui', false);
    expect(store.comfyReady).toBe(false);
  });

  it('records autoDetectAt on a successful auto-detect run', async () => {
    const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service: fakeService() });
    expect(store.autoDetectAt).toBeUndefined();
    const before = Date.now();
    await store.autoDetect();
    expect(store.autoDetectAt).toBeGreaterThanOrEqual(before);
  });

  describe('testConnection', () => {
    it('returns ok when the probe responds 200', async () => {
      const probeHttp = vi.fn(async () => undefined);
      const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service: fakeService({ probeHttp }) });
      const r = await store.testConnection('ollama');
      expect(r.ok).toBe(true);
      expect(probeHttp).toHaveBeenCalledWith('http://127.0.0.1:11434/api/version');
    });

    it('reports an HTTP error when the probe responds non-2xx', async () => {
      const store = new LocalRuntimeStore({
        autoDetect: async () => ({}),
        service: fakeService({ probeHttp: vi.fn(async () => { throw new Error('HTTP 503 from http://127.0.0.1:8188/system_stats'); }) }),
      });
      const r = await store.testConnection('comfyui');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/HTTP 503/);
    });

    it('reports the error verbatim when probe rejects (network unreachable)', async () => {
      const store = new LocalRuntimeStore({
        autoDetect: async () => ({}),
        service: fakeService({ probeHttp: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) }),
      });
      const r = await store.testConnection('ollama');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ECONNREFUSED/);
    });
  });

  describe('starting watchdog', () => {
    it('flips a stuck "starting" runtime to "crashed" after the watchdog timeout', async () => {
      vi.useFakeTimers();
      try {
        // Service start resolves but the status snapshot keeps reporting
        // "starting" — simulating a process that came up but never became
        // healthy (port collision, model load wedged, etc.).
        const service = fakeService({
          startRuntime: vi.fn(async () => undefined),
          getRuntimeStatus: vi.fn(async () => ({ running: true, status: 'starting' as const, logs: [] })),
        });
        const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
        store.setInstallPath('ollama', 'C:\\Ollama\\ollama.exe');
        const startPromise = store.start('ollama');
        // Drain awaited microtasks inside start() so we settle into 'starting'.
        await vi.advanceTimersByTimeAsync(0);
        await startPromise;
        expect(store.runtimes.ollama.status).toBe('starting');

        // Roll the wall clock past the watchdog threshold.
        await vi.advanceTimersByTimeAsync(STARTING_WATCHDOG_MS + 100);

        expect(store.runtimes.ollama.status).toBe('crashed');
        expect(store.runtimes.ollama.lastError).toMatch(/did not become healthy/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps showing "starting" while in the start window even if the host reports "offline"', async () => {
      // ComfyUI's bring-up sequence is "process spawned → CUDA init →
      // model load → HTTP server up". During the model-load window the
      // Rust host returns 'offline' (process exists, health endpoint
      // not answering yet). Without the sticky-starting gate the UI
      // would flick to "Offline" and the Start button would re-appear,
      // making the user think nothing happened.
      vi.useFakeTimers();
      try {
        const service = fakeService({
          startRuntime: vi.fn(async () => undefined),
          getRuntimeStatus: vi.fn(async () => ({ running: true, status: 'offline' as const, logs: [], pid: 7 })),
        });
        const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
        store.setInstallPath('comfyui', 'C:\\ComfyUI');

        await store.start('comfyui');

        // The sticky gate: even though the host snapshot is 'offline',
        // we're inside the watchdog window so the user sees 'starting'.
        expect(store.runtimes.comfyui.status).toBe('starting');

        // Subsequent polls during the same window keep showing 'starting'.
        await store.refreshStatus('comfyui');
        expect(store.runtimes.comfyui.status).toBe('starting');
      } finally {
        vi.useRealTimers();
      }
    });

    it('breaks out of "starting" once the host reports "online"', async () => {
      vi.useFakeTimers();
      try {
        let nextStatus: 'offline' | 'online' = 'offline';
        const service = fakeService({
          startRuntime: vi.fn(async () => undefined),
          getRuntimeStatus: vi.fn(async () => ({ running: true, status: nextStatus, logs: [], pid: 1 })),
        });
        const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
        store.setInstallPath('comfyui', 'C:\\ComfyUI');

        await store.start('comfyui');
        expect(store.runtimes.comfyui.status).toBe('starting');

        // Health probe finally answers — UI flips to online and the
        // watchdog clears.
        nextStatus = 'online';
        await store.refreshStatus('comfyui');
        expect(store.runtimes.comfyui.status).toBe('online');

        // Watchdog cleared: rolling time forward must NOT flip to crashed.
        await vi.advanceTimersByTimeAsync(STARTING_WATCHDOG_MS + 100);
        expect(store.runtimes.comfyui.status).toBe('online');
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels the watchdog when status becomes online', async () => {
      vi.useFakeTimers();
      try {
        const service = fakeService({
          startRuntime: vi.fn(async () => undefined),
          getRuntimeStatus: vi.fn(async () => ({ running: true, status: 'online' as const, logs: [], pid: 1 })),
        });
        const store = new LocalRuntimeStore({ autoDetect: async () => ({}), service });
        store.setInstallPath('ollama', 'C:\\Ollama\\ollama.exe');
        await store.start('ollama');
        expect(store.runtimes.ollama.status).toBe('online');

        // Advance past the watchdog window — status must stay online, not flip to crashed.
        await vi.advanceTimersByTimeAsync(STARTING_WATCHDOG_MS + 100);
        expect(store.runtimes.ollama.status).toBe('online');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

function fakeService(overrides: Partial<LocalRuntimeStore['service']> = {}): LocalRuntimeStore['service'] {
  return {
    startRuntime: vi.fn(async () => undefined),
    stopRuntime: vi.fn(async () => undefined),
    getRuntimeStatus: vi.fn(async () => ({ running: false, status: 'stopped' as const, logs: [] })),
    probeHttp: vi.fn(async () => undefined),
    fetchOllamaTags: vi.fn(async () => ({ models: [] })),
    pathExists: vi.fn(async () => false),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    getCandidatePaths: vi.fn(async () => null),
    ...overrides,
  };
}

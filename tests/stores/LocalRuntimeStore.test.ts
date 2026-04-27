import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRuntimeStore } from '../../src/stores/LocalRuntimeStore';
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
});

function fakeService(overrides: Partial<LocalRuntimeStore['service']> = {}): LocalRuntimeStore['service'] {
  return {
    startRuntime: vi.fn(async () => undefined),
    stopRuntime: vi.fn(async () => undefined),
    getRuntimeStatus: vi.fn(async () => ({ running: false, status: 'stopped' as const, logs: [] })),
    pathExists: vi.fn(async () => false),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    getCandidatePaths: vi.fn(async () => null),
    ...overrides,
  };
}

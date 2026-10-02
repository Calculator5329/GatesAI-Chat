import { describe, expect, it, vi } from 'vitest';
import { detectLocalRuntimes } from '../../../src/services/local/autoDetect';

describe('detectLocalRuntimes', () => {
  it('detects the first matching Ollama executable and ComfyUI portable root', async () => {
    const exists = vi.fn(async (path: string) =>
      path === 'C:\\Users\\Ada\\AppData\\Local\\Programs\\Ollama\\ollama.exe' ||
      path === 'C:\\Users\\Ada\\Downloads\\ComfyUI_fresh\\ComfyUI_windows_portable\\python_embeded\\python.exe' ||
      path === 'C:\\Users\\Ada\\Downloads\\ComfyUI_fresh\\ComfyUI_windows_portable\\ComfyUI\\main.py'
    );

    const result = await detectLocalRuntimes({
      platform: 'win32',
      homeDir: 'C:\\Users\\Ada',
      localAppData: 'C:\\Users\\Ada\\AppData\\Local',
      comfyCandidates: ['C:\\Users\\Ada\\Downloads\\ComfyUI_fresh'],
      pathExists: exists,
    });

    expect(result.ollama?.installPath).toBe('C:\\Users\\Ada\\AppData\\Local\\Programs\\Ollama\\ollama.exe');
    expect(result.comfyui?.installPath).toBe('C:\\Users\\Ada\\Downloads\\ComfyUI_fresh\\ComfyUI_windows_portable');
  });

  it('returns an empty result when known candidates are missing', async () => {
    const result = await detectLocalRuntimes({
      platform: 'win32',
      homeDir: 'C:\\Users\\Ada',
      localAppData: 'C:\\Users\\Ada\\AppData\\Local',
      comfyCandidates: ['C:\\Users\\Ada\\Downloads\\ComfyUI_fresh'],
      pathExists: async () => false,
    });

    expect(result).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { detectDesktopPlatform, ollamaExecutableName, runtimeInstallPlaceholder } from '../../../src/services/local/platformCopy';

describe('local runtime platform copy', () => {
  it('uses Linux executable names and paths', () => {
    expect(detectDesktopPlatform('Linux x86_64')).toBe('linux');
    expect(ollamaExecutableName('linux')).toBe('ollama');
    expect(runtimeInstallPlaceholder('ollama', 'linux')).toBe('/usr/bin/ollama');
    expect(runtimeInstallPlaceholder('comfyui', 'linux')).toBe('/home/you/ComfyUI');
  });

  it('retains Windows-specific executable names and paths on Windows', () => {
    expect(detectDesktopPlatform('Win32')).toBe('windows');
    expect(ollamaExecutableName('windows')).toBe('ollama.exe');
    expect(runtimeInstallPlaceholder('ollama', 'windows')).toContain('C:\\Users\\you');
  });
});

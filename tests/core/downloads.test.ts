import { describe, expect, it } from 'vitest';
import { downloadLinks, recommendedDownload } from '../../src/core/downloads';

describe('recommendedDownload', () => {
  it('recommends the Windows x64 installer for Windows', () => {
    const rec = recommendedDownload('windows', 'x64');
    expect(rec.kind).toBe('windows-exe');
    expect(rec.url).toBe(downloadLinks.windowsExe);
    expect(rec.runsOn).toMatch(/Windows/);
    expect(rec.note).toBeUndefined();
  });

  it('notes ARM emulation for Windows on ARM but still offers the x64 installer', () => {
    const rec = recommendedDownload('windows', 'arm64');
    expect(rec.kind).toBe('windows-exe');
    expect(rec.url).toBe(downloadLinks.windowsExe);
    expect(rec.note).toMatch(/emulation/i);
  });

  it('recommends the AppImage for Linux x64', () => {
    const rec = recommendedDownload('linux', 'x64');
    expect(rec.kind).toBe('linux-appimage');
    expect(rec.url).toBe(downloadLinks.linuxAppImage);
  });

  it('falls back to source for macOS, ARM Linux, and unknown platforms', () => {
    for (const rec of [
      recommendedDownload('macos', 'arm64'),
      recommendedDownload('linux', 'arm64'),
      recommendedDownload('other', 'unknown'),
    ]) {
      expect(rec.kind).toBe('source');
      expect(rec.url).toBe(downloadLinks.repo);
    }
  });
});

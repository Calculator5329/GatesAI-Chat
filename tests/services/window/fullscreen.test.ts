import { afterEach, describe, expect, it, vi } from 'vitest';
import { toggleFullscreen } from '../../../src/services/window/fullscreen';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
});

describe('toggleFullscreen (web path)', () => {
  it('requests fullscreen on the document element when not fullscreen', async () => {
    const request = vi.fn(async () => undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });

    await expect(toggleFullscreen()).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('exits fullscreen when already fullscreen', async () => {
    const exit = vi.fn(async () => undefined);
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });

    await expect(toggleFullscreen()).resolves.toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('returns null instead of throwing when the platform refuses', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: vi.fn(async () => { throw new Error('denied'); }),
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });

    await expect(toggleFullscreen()).resolves.toBeNull();
  });
});

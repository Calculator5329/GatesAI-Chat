import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __imageCacheTestApi,
  loadImageSource,
} from '../../../src/components/media/useImageDataUrl';

describe('gallery image-source resolution', () => {
  beforeEach(() => {
    __imageCacheTestApi.reset();
    vi.restoreAllMocks();
  });

  it('turns workspace image bytes into a browser-renderable data URL', async () => {
    const readAttachmentBase64 = vi.fn(async () => ({
      base64: 'AQID',
      mime: 'image/webp',
      size: 3,
    }));

    const source = await loadImageSource(
      { readAttachmentBase64 } as never,
      '/workspace/artifacts/images/render.webp',
    );

    expect(readAttachmentBase64).toHaveBeenCalledWith('/workspace/artifacts/images/render.webp');
    expect(source).toBe('data:image/webp;base64,AQID');
  });

  it('inlines hosted image bytes with their response mime type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { 'content-type': 'image/avif; charset=binary' } },
    ));

    const source = await loadImageSource(
      { readAttachmentBase64: vi.fn() } as never,
      'https://images.example.test/render.avif',
    );

    expect(fetchMock).toHaveBeenCalledWith('https://images.example.test/render.avif');
    expect(source).toBe('data:image/avif;base64,AQID');
  });
});

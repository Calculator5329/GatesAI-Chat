import { describe, expect, it } from 'vitest';
import {
  IMAGE_ASPECT_RATIOS,
  bytesToBase64,
  dimsForAspect,
  dimsForRequest,
  isImageAspectRatio,
  isLocalImageBackend,
  mimeFromUrl,
  safeText,
  validateExplicitDimensions,
  wrapGlobalFetch,
} from '../../../src/services/image/types';

describe('isImageAspectRatio', () => {
  it.each(IMAGE_ASPECT_RATIOS)('accepts %s', (ratio) => {
    expect(isImageAspectRatio(ratio)).toBe(true);
  });

  it.each([null, undefined, 0, '', '4:3', '1', 'portrait', {}, []])(
    'rejects %p',
    (value) => {
      expect(isImageAspectRatio(value)).toBe(false);
    },
  );
});

describe('isLocalImageBackend', () => {
  it('returns true for the supported local backend', () => {
    expect(isLocalImageBackend('local-comfy')).toBe(true);
  });
});

describe('dimsForAspect', () => {
  it('produces SDXL-class dimensions for every aspect', () => {
    expect(dimsForAspect('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(dimsForAspect('3:2')).toEqual({ width: 1216, height: 832 });
    expect(dimsForAspect('2:3')).toEqual({ width: 832, height: 1216 });
    expect(dimsForAspect('16:9')).toEqual({ width: 1344, height: 768 });
    expect(dimsForAspect('9:16')).toEqual({ width: 768, height: 1344 });
  });

  it('returns dimensions that are multiples of 16 (local backend constraint)', () => {
    for (const ratio of IMAGE_ASPECT_RATIOS) {
      const { width, height } = dimsForAspect(ratio);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
    }
  });
});

describe('validateExplicitDimensions', () => {
  it('accepts both undefined (caller falls back to aspect ratio)', () => {
    expect(validateExplicitDimensions(undefined, undefined)).toBeNull();
  });

  it('rejects partial input', () => {
    expect(validateExplicitDimensions(1024, undefined)).toMatch(/both/i);
    expect(validateExplicitDimensions(undefined, 1024)).toMatch(/both/i);
  });

  it('rejects non-number input', () => {
    expect(validateExplicitDimensions('1024', '1024')).toMatch(/numbers/i);
    expect(validateExplicitDimensions(true, 1024)).toMatch(/numbers/i);
  });

  it('rejects non-finite numbers', () => {
    expect(validateExplicitDimensions(NaN, 1024)).toMatch(/finite/i);
    expect(validateExplicitDimensions(Infinity, 1024)).toMatch(/finite/i);
  });

  it('rejects non-integer numbers', () => {
    expect(validateExplicitDimensions(1024.5, 1024)).toMatch(/whole/i);
  });

  it('rejects below the 64px floor', () => {
    expect(validateExplicitDimensions(48, 1024)).toMatch(/at least/i);
  });

  it('rejects above the 4096px ceiling', () => {
    expect(validateExplicitDimensions(8192, 1024)).toMatch(/at most/i);
  });

  it('rejects values that are not multiples of 16', () => {
    expect(validateExplicitDimensions(1023, 1024)).toMatch(/multiples of 16/i);
    expect(validateExplicitDimensions(1024, 1000)).toMatch(/multiples of 16/i);
  });

  it('accepts well-formed pairs', () => {
    expect(validateExplicitDimensions(1024, 1024)).toBeNull();
    expect(validateExplicitDimensions(64, 64)).toBeNull();
    expect(validateExplicitDimensions(4096, 4096)).toBeNull();
    expect(validateExplicitDimensions(1216, 832)).toBeNull();
  });
});

describe('dimsForRequest', () => {
  it('uses explicit dimensions when both supplied and allowed', () => {
    expect(dimsForRequest({ width: 1216, height: 832 })).toEqual({ width: 1216, height: 832 });
  });

  it('falls back to aspectRatio when explicit dims are not provided', () => {
    expect(dimsForRequest({ aspectRatio: '16:9' })).toEqual({ width: 1344, height: 768 });
  });

  it('defaults to 1:1 when neither aspectRatio nor explicit dims are given', () => {
    expect(dimsForRequest({})).toEqual({ width: 1024, height: 1024 });
  });

  it('throws on invalid explicit dimensions', () => {
    expect(() => dimsForRequest({ width: 1023, height: 1024 })).toThrow(/multiples of 16/i);
    expect(() => dimsForRequest({ width: 32, height: 32 })).toThrow(/at least/i);
  });

  it('honors allowExplicit:false by ignoring explicit dims', () => {
    expect(
      dimsForRequest({ width: 1216, height: 832, aspectRatio: '1:1' }, { allowExplicit: false }),
    ).toEqual({ width: 1024, height: 1024 });
  });
});

describe('bytesToBase64', () => {
  it('encodes empty input', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });

  it('round-trips with atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 250, 255]);
    const decoded = atob(bytesToBase64(bytes));
    const reBytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(Array.from(reBytes)).toEqual(Array.from(bytes));
  });

  it('handles a payload larger than the chunk boundary without overflowing the call stack', () => {
    // Chunk size is 0x8000; cross it twice so we exercise the loop.
    const big = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const base64 = bytesToBase64(big);
    expect(base64.length).toBeGreaterThan(0);
    // Decode a prefix and verify alignment.
    const head = Uint8Array.from(atob(base64.slice(0, 12)), (c) => c.charCodeAt(0));
    expect(head.slice(0, 8)).toEqual(big.slice(0, 8));
  });
});

describe('mimeFromUrl', () => {
  it('detects common image extensions', () => {
    expect(mimeFromUrl('http://x/y.png')).toBe('image/png');
    expect(mimeFromUrl('/foo/bar.jpg')).toBe('image/jpeg');
    expect(mimeFromUrl('/foo/bar.JPEG')).toBe('image/jpeg');
    expect(mimeFromUrl('asset.webp')).toBe('image/webp');
    expect(mimeFromUrl('a.gif')).toBe('image/gif');
  });

  it('strips query strings before sniffing the extension', () => {
    expect(mimeFromUrl('http://x/img.jpg?foo=bar')).toBe('image/jpeg');
  });

  it('defaults to image/png for unknown extensions', () => {
    expect(mimeFromUrl('something.tiff')).toBe('image/png');
    expect(mimeFromUrl('no-extension')).toBe('image/png');
  });
});

describe('safeText', () => {
  it('returns the response text', async () => {
    const r = new Response('hello world');
    expect(await safeText(r)).toBe('hello world');
  });

  it('caps at 500 characters', async () => {
    const r = new Response('a'.repeat(2000));
    expect((await safeText(r)).length).toBe(500);
  });

  it('returns empty string when reading throws', async () => {
    const broken = { text: async () => { throw new Error('bad'); } } as unknown as Response;
    expect(await safeText(broken)).toBe('');
  });
});

describe('wrapGlobalFetch', () => {
  it('uses the override implementation when one is provided', async () => {
    let called = 0;
    const stub = (async () => {
      called++;
      return new Response('ok');
    }) as unknown as typeof fetch;
    const wrapped = wrapGlobalFetch(stub);
    const resp = await wrapped('http://x/');
    expect(await resp.text()).toBe('ok');
    expect(called).toBe(1);
  });

  it('delegates to globalThis.fetch when no override is supplied', async () => {
    const original = globalThis.fetch;
    let seen = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen = typeof input === 'string' ? input : input.toString();
      return new Response('hi');
    }) as typeof fetch;
    try {
      const wrapped = wrapGlobalFetch();
      const resp = await wrapped('http://example/');
      expect(seen).toBe('http://example/');
      expect(await resp.text()).toBe('hi');
    } finally {
      globalThis.fetch = original;
    }
  });
});

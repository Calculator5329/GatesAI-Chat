import { useEffect, useState } from 'react';
import type { BridgeStore } from '../../stores/BridgeStore';
import { useBridgeStore } from '../../stores/context';

/**
 * Single source of truth for "render a workspace path or hosted URL as
 * an image source." Three components used to roll their own copy with
 * inconsistent caches (one unbounded, leaking memory across long
 * sessions). This module owns the LRU + the bridge round-trip.
 *
 * The cap (32 entries × ~7 MB FLUX render ≈ 220 MB) is a safe ceiling
 * for a session that stays scrollable in chat. Without it a long
 * session would balloon the WebView past the per-process limit and
 * crash the renderer with no visible warning.
 */
const IMAGE_CACHE_LIMIT = 32;

const imageCache = new Map<string, string>();
const inflightLoads = new Map<string, Promise<string | null>>();

function cacheGet(key: string): string | undefined {
  const url = imageCache.get(key);
  if (url === undefined) return undefined;
  imageCache.delete(key);
  imageCache.set(key, url);
  return url;
}

function cacheSet(key: string, url: string): void {
  if (imageCache.has(key)) imageCache.delete(key);
  imageCache.set(key, url);
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadHostedImage(url: string): Promise<string | null> {
  const cached = cacheGet(url);
  if (cached) return cached;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const mime = resp.headers.get('content-type')?.split(';')[0] || 'image/png';
    const dataUrl = `data:${mime};base64,${bytesToBase64(new Uint8Array(await resp.arrayBuffer()))}`;
    cacheSet(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export async function loadImageSource(bridge: BridgeStore, path: string): Promise<string | null> {
  const cached = cacheGet(path);
  if (cached) return cached;
  const inflight = inflightLoads.get(path);
  if (inflight) return inflight;
  const promise = loadImageSourceUncached(bridge, path).finally(() => {
    inflightLoads.delete(path);
  });
  inflightLoads.set(path, promise);
  return promise;
}

async function loadImageSourceUncached(bridge: BridgeStore, path: string): Promise<string | null> {
  if (/^https?:\/\//i.test(path)) {
    // Hosted URLs render directly via <img src> — but Lightbox's full-size
    // view needs the bytes inlined for cross-origin / WebView quirks, so
    // we cache them as data URLs too. Callers that prefer the bare URL
    // (thumbnail) can short-circuit before calling.
    return loadHostedImage(path);
  }
  const result = await bridge.readAttachmentBase64(path);
  if (!result) return null;
  const url = `data:${result.mime};base64,${result.base64}`;
  cacheSet(path, url);
  return url;
}

/**
 * Resolves `path` (a workspace path or http(s) URL) to a renderable image
 * source. Returns `{ src, failed }` — `src` is null until the load
 * resolves; `failed` flips true on a hard miss. Cancellation safe across
 * unmount and path changes.
 */
export function useImageDataUrl(path: string): { src: string | null; failed: boolean } {
  const bridge = useBridgeStore();
  const [loaded, setLoaded] = useState<{ path: string; src: string | null; failed: boolean }>(() => ({
    path,
    src: cacheGet(path) ?? null,
    failed: false,
  }));

  const cached = cacheGet(path);
  const current = loaded.path === path
    ? loaded
    : { path, src: cached ?? null, failed: false };

  useEffect(() => {
    const cached = cacheGet(path);
    if (cached) return;
    let cancelled = false;
    void loadImageSource(bridge, path).then(url => {
      if (cancelled) return;
      setLoaded({ path, src: url, failed: !url });
    });
    return () => { cancelled = true; };
  }, [bridge, path]);

  return { src: current.src, failed: current.failed };
}

export const __imageCacheTestApi = {
  reset: () => {
    imageCache.clear();
    inflightLoads.clear();
  },
  size: () => imageCache.size,
  inflightSize: () => inflightLoads.size,
  has: (path: string) => imageCache.has(path),
  set: (path: string, url: string) => cacheSet(path, url),
  get: (path: string) => cacheGet(path),
  limit: IMAGE_CACHE_LIMIT,
};

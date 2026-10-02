import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYCHAIN_WAIT_MS, RootStore } from '../../src/stores/RootStore';
import { clearAppStorage } from '../helpers/storage';

const keychain = vi.hoisted(() => ({ ollamaKey: Promise.resolve<string | null>(null) }));

vi.mock('../../src/services/secretStorage', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/services/secretStorage')>();
  return {
    ...actual,
    getSecret: (name: string) => name === actual.SECRET_NAMES.ollamaApiKey ? keychain.ollamaKey : Promise.resolve(null),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Records each /api/tags request's Authorization header; everything else fails like a dead network. */
function stubTagsFetch(): Array<string | null> {
  const tagAuth: Array<string | null> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/api/tags')) throw new Error('no network in test');
    tagAuth.push(new Headers(init?.headers).get('authorization'));
    return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return tagAuth;
}

describe('RootStore local runtime monitoring at boot', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAppStorage();
  });

  it('waits for the keychain so a keyed remote Ollama is first probed with its key', async () => {
    const key = deferred<string | null>();
    keychain.ollamaKey = key.promise;
    const tagAuth = stubTagsFetch();
    const root = new RootStore({ runtime: 'desktop' });

    root.boot();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tagAuth).toEqual([]);

    key.resolve('remote-test-key');
    await vi.waitFor(() => expect(tagAuth).toHaveLength(1));
    expect(tagAuth[0]).toBe('Bearer remote-test-key');
    root.dispose();
  });

  it('still starts monitoring when the keychain read fails', async () => {
    const key = deferred<string | null>();
    keychain.ollamaKey = key.promise;
    const tagAuth = stubTagsFetch();
    const root = new RootStore({ runtime: 'desktop' });

    root.boot();
    key.reject(new Error('keychain locked'));

    await vi.waitFor(() => expect(tagAuth).toEqual([null]));
    root.dispose();
  });

  it('stops waiting for a keychain that never answers and re-probes when the key lands', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const key = deferred<string | null>();
      keychain.ollamaKey = key.promise;
      const tagAuth = stubTagsFetch();
      const root = new RootStore({ runtime: 'desktop' });

      root.boot();
      await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS - 1);
      expect(tagAuth).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(tagAuth).toEqual([null]);

      key.resolve('remote-test-key');
      await vi.advanceTimersByTimeAsync(0);
      expect(tagAuth).toEqual([null, 'Bearer remote-test-key']);
      root.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

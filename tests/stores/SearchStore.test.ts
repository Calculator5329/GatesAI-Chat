import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchStore } from '../../src/stores/SearchStore';
import { clearAppStorage } from '../helpers/storage';
import { flush } from '../helpers/mockProvider';

describe('SearchStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('stores and clears the Brave key locally', async () => {
    const store = new SearchStore(fakeClient());
    store.setBraveKey(' brv-test ');
    await flush(2);

    const reloaded = new SearchStore(fakeClient());
    expect(reloaded.braveReady).toBe(true);
    expect(reloaded.braveApiKey).toBe('brv-test');

    reloaded.clearBraveKey();
    await flush(2);
    expect(new SearchStore(fakeClient()).braveReady).toBe(false);
  });

  it('runs searches in parallel and preserves result order', async () => {
    const starts: string[] = [];
    const resolvers = new Map<string, () => void>();
    const client = {
      searchContext: async (_apiKey: string, req: { query: string }) => {
        starts.push(req.query);
        await new Promise<void>(resolve => resolvers.set(req.query, resolve));
        return [{ title: req.query, url: `https://example.com/${req.query}`, text: req.query }];
      },
    };
    const store = new SearchStore(client);
    store.setBraveKey('brv-test');

    const pending = store.searchBraveContext({ queries: ['a', 'b', 'c'] });
    await flush(2);
    expect(starts).toEqual(['a', 'b', 'c']);

    resolvers.get('c')?.();
    resolvers.get('b')?.();
    resolvers.get('a')?.();
    const results = await pending;

    expect(results.map(result => result.query)).toEqual(['a', 'b', 'c']);
  });

  it('caches repeated searches for the same normalized options', async () => {
    let calls = 0;
    const client = {
      searchContext: async (_apiKey: string, req: { query: string }) => {
        calls += 1;
        return [{ title: req.query, url: 'https://example.com', text: 'cached' }];
      },
    };
    const store = new SearchStore(client);
    store.setBraveKey('brv-test');

    await store.searchBraveContext({ queries: ['React 19'], country: 'us' });
    await store.searchBraveContext({ queries: [' react   19 '], country: 'US' });

    expect(calls).toBe(1);
  });

  it('returns per-query failures without failing the whole batch', async () => {
    const client = {
      searchContext: async (_apiKey: string, req: { query: string }) => {
        if (req.query === 'bad') throw new Error('network down');
        return [{ title: req.query, url: 'https://example.com', text: 'ok' }];
      },
    };
    const store = new SearchStore(client);
    store.setBraveKey('brv-test');

    const results = await store.searchBraveContext({ queries: ['good', 'bad'] });

    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, errorCode: 'search_error' });
  });
});

function fakeClient() {
  return {
    searchContext: async (_apiKey: string, req: { query: string }) => [
      { title: req.query, url: 'https://example.com', text: 'ok' },
    ],
  };
}


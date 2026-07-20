import { describe, expect, it, vi } from 'vitest';
import { BraveSearchClient, BraveSearchError } from '../../../src/services/search/braveClient';

describe('BraveSearchClient', () => {
  it('keeps browser fetch bound to the global object', async () => {
    const fetchImpl = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({ grounding: { generic: [] } }), { status: 200 }));
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);
    const client = new BraveSearchClient();

    await expect(client.searchContext('brv-test', { query: 'binding' })).resolves.toEqual([]);
  });

  it('builds the LLM Context request and parses grounding sources', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('https://api.search.brave.com/res/v1/llm/context?');
      expect(url).toContain('q=react+19');
      expect(url).toContain('count=10');
      expect(url).toContain('maximum_number_of_urls=10');
      expect(url).toContain('maximum_number_of_tokens=4096');
      expect(url).toContain('maximum_number_of_tokens_per_url=2048');
      expect(url).toContain('context_threshold_mode=balanced');
      expect(url).toContain('country=GB');
      expect(url).toContain('search_lang=en');
      expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('brv-test');
      return new Response(JSON.stringify({
        grounding: {
          generic: [
            { title: 'React 19', url: 'https://react.dev/blog', content: 'React 19 details.' },
            { title: 'Ignored', content: 'no url' },
          ],
        },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new BraveSearchClient({ fetchImpl });

    const sources = await client.searchContext('brv-test', { query: 'react 19', country: 'gb' });

    expect(sources).toEqual([
      { title: 'React 19', url: 'https://react.dev/blog', text: 'React 19 details.' },
    ]);
  });

  it('uses the larger official context budget for deep research', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('count=50');
      expect(url).toContain('maximum_number_of_urls=30');
      expect(url).toContain('maximum_number_of_tokens=16384');
      expect(url).toContain('maximum_number_of_tokens_per_url=4096');
      return new Response(JSON.stringify({ grounding: { generic: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new BraveSearchClient({ fetchImpl });

    await client.searchContext('brv-test', { query: 'complex topic', depth: 'deep' });
  });

  it('returns an empty source list for empty grounding', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ grounding: { generic: [] } }), { status: 200 })) as unknown as typeof fetch;
    const client = new BraveSearchClient({ fetchImpl });

    await expect(client.searchContext('brv-test', { query: 'nothing' })).resolves.toEqual([]);
  });

  it.each([
    [401, 'auth_error'],
    [403, 'auth_error'],
    [429, 'rate_limited'],
    [503, 'brave_unavailable'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status })) as unknown as typeof fetch;
    const client = new BraveSearchClient({ fetchImpl });

    await expect(client.searchContext('brv-test', { query: 'x' })).rejects.toMatchObject({ code });
  });

  it('turns aborts into timeout_or_aborted errors', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort();
      init?.signal?.dispatchEvent(new Event('abort'));
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const client = new BraveSearchClient({ fetchImpl });

    await expect(client.searchContext('brv-test', { query: 'x', signal: controller.signal })).rejects.toBeInstanceOf(BraveSearchError);
    await expect(client.searchContext('brv-test', { query: 'x', signal: controller.signal })).rejects.toMatchObject({ code: 'timeout_or_aborted' });
  });

  it('uses the desktop Tauri command path when requested', async () => {
    const tauriInvoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      expect(cmd).toBe('brave_llm_context');
      expect(args).toMatchObject({
        apiKey: 'brv-test',
        query: 'react 19',
        country: 'GB',
        searchLang: 'en',
        depth: 'standard',
      });
      return {
        grounding: {
          generic: [
            { title: 'React 19', url: 'https://react.dev/blog', content: 'React context from desktop.' },
          ],
        },
      } as T;
    };
    const client = new BraveSearchClient({ useTauri: true, tauriInvoke });

    await expect(client.searchContext('brv-test', { query: 'react 19', country: 'gb' })).resolves.toEqual([
      { title: 'React 19', url: 'https://react.dev/blog', text: 'React context from desktop.' },
    ]);
  });

  it('keeps structured desktop Brave errors', async () => {
    const client = new BraveSearchClient({
      useTauri: true,
      tauriInvoke: vi.fn(async () => {
        throw { code: 'auth_error', message: 'Brave Search returned HTTP 401.' };
      }),
    });

    await expect(client.searchContext('brv-test', { query: 'x' })).rejects.toMatchObject({
      code: 'auth_error',
      message: 'Brave Search returned HTTP 401.',
    });
  });

  it('explains browser Failed to fetch as a runtime/network failure', async () => {
    const client = new BraveSearchClient({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });

    await expect(client.searchContext('brv-test', { query: 'x' })).rejects.toMatchObject({
      code: 'network_error',
      message: expect.stringContaining('browser/dev tab'),
    });
  });
});

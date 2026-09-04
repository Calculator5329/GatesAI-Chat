// Fetch interception for dev scenarios. Every provider seam in the app calls
// the global `fetch` at request time (openaiCompat, openrouterCatalog,
// health.ts, ollama.ts, localRuntimeService, braveClient, the OpenRouter image
// client through wrapGlobalFetch), so replacing window.fetch before the stores
// boot is enough to answer all of them. Unmatched requests fall through to the
// real fetch so Vite's own traffic and the agent-handles drive API keep working.
import type { MockRequest, MockRoute, RecordedCall } from '../types';

export interface FetchMock {
  fetch: typeof fetch;
  calls: RecordedCall[];
}

export function createFetchMock(routes: MockRoute[], fallback: typeof fetch): FetchMock {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = await toMockRequest(input, init);
    const route = routes.find(candidate => candidate.matches(req));
    if (!route) return fallback(input, init);
    calls.push({ route: route.name, method: req.method, url: req.url.toString(), at: Date.now(), body: req.body });
    if (init?.signal?.aborted) throw abortError();
    return route.respond(req);
  };
  return { fetch: fetchImpl, calls };
}

async function toMockRequest(input: RequestInfo | URL, init?: RequestInit): Promise<MockRequest> {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const body = init?.body !== undefined ? bodyToString(init.body) : await input.clone().text().catch(() => null);
    return {
      url: new URL(input.url),
      method: (init?.method ?? input.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers ?? input.headers),
      body: body || null,
    };
  }
  const href = typeof input === 'string' ? input : input.toString();
  return {
    url: new URL(href, typeof location !== 'undefined' ? location.href : 'http://localhost'),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: new Headers(init?.headers),
    body: init?.body !== undefined ? bodyToString(init.body) : null,
  };
}

function bodyToString(body: BodyInit | null | undefined): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

export function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    statusText: status >= 400 ? 'Mocked error' : 'OK',
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(text: string, status: number, contentType = 'text/plain'): Response {
  return new Response(text, { status, statusText: status >= 400 ? 'Mocked error' : 'OK', headers: { 'content-type': contentType } });
}

/** The browser's shape for a connection refused / DNS failure. */
export function networkFailure(url: URL): never {
  throw new TypeError(`Failed to fetch (${url.host} is offline in this scenario)`);
}

function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

export interface StreamOptions {
  delayMs?: number;
  contentType: string;
}

/**
 * Stream `frames` one at a time. With delayMs > 0 the reader sees each frame
 * arrive separately, which is what lets a journey observe the stop control
 * mid-reply; with 0 the frames are still delivered as distinct chunks.
 */
export function streamedResponse(frames: string[], options: StreamOptions): Response {
  const encoder = new TextEncoder();
  const delayMs = options.delayMs ?? 0;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= frames.length) {
        controller.close();
        return;
      }
      if (delayMs > 0 && index > 0) await sleep(delayMs);
      controller.enqueue(encoder.encode(frames[index]));
      index += 1;
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': options.contentType } });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function hostMatches(req: MockRequest, host: string): boolean {
  return req.url.host === host;
}

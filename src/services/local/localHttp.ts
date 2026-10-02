// fetch-compatible transport for every Ollama and ComfyUI HTTP call.
// Desktop: the request runs in Rust (`local_http_request` in src-tauri/src/local_http.rs),
// so CORS and the webview Origin never apply and the host can be any http(s)
// server; the response streams back over a Tauri channel into a real Response.
// Web Lite: plain window.fetch, looked up at call time so test and dev-scenario
// fetch mocks keep working.
import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';
import { logger } from '../diagnostics/logger';

export interface LocalFetchInit {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** JSON events from Rust. Body chunks arrive between `head` and `end` as ArrayBuffers. */
type LocalHttpEvent =
  | { event: 'head'; status: number; statusText: string; contentType: string | null }
  | { event: 'end' }
  | { event: 'error'; message: string };

type LocalHttpMessage = LocalHttpEvent | ArrayBuffer;

/** Statuses the Fetch spec forbids a body on; `new Response(stream, ...)` throws for them. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const SESSION = Date.now().toString(36);
let requestSeq = 0;

/**
 * fetch-compatible. Desktop: proxied through Rust (no CORS/Origin, any http(s)
 * host, path allowlisted to Ollama and ComfyUI APIs), streamed. Browser: window.fetch.
 */
export function localFetch(url: string, init?: LocalFetchInit): Promise<Response> {
  if (!isTauri()) return fetch(url, init);
  return proxiedFetch(url, init ?? {});
}

/**
 * Resolves with a Response once Rust sends `head`; the body stream then fills
 * from channel chunks. Abort rejects (or errors the body) with the signal's
 * reason, like fetch, and tells Rust to drop the request.
 */
function proxiedFetch(url: string, init: LocalFetchInit): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const id = `${SESSION}-${++requestSeq}`;

  return new Promise<Response>((resolve, reject) => {
    let phase: 'waiting' | 'streaming' | 'done' = 'waiting';
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      cancel() {
        finish();
        cancelRemote();
      },
    });

    function finish(): void {
      phase = 'done';
      signal?.removeEventListener('abort', onAbort);
    }

    function fail(error: unknown): void {
      if (phase === 'waiting') reject(error);
      else if (phase === 'streaming') controller?.error(error);
      finish();
    }

    function cancelRemote(): void {
      started
        .then(() => invoke('local_http_cancel', { id }))
        .catch((err: unknown) => logger.warn('local-runtime', 'Could not cancel local request', { url, error: errorMessage(err) }));
    }

    function onAbort(): void {
      if (phase === 'done' || !signal) return;
      fail(abortReason(signal));
      cancelRemote();
    }

    function onHead(event: Extract<LocalHttpEvent, { event: 'head' }>): void {
      try {
        const response = new Response(NULL_BODY_STATUSES.has(event.status) ? null : body, {
          status: event.status,
          statusText: event.statusText,
          headers: event.contentType ? { 'content-type': event.contentType } : undefined,
        });
        phase = 'streaming';
        resolve(response);
      } catch (err) {
        fail(new TypeError(errorMessage(err)));
        cancelRemote();
      }
    }

    const channel = new Channel<LocalHttpMessage>();
    channel.onmessage = message => {
      if (phase === 'done') return;
      // Structural check, not instanceof: the buffer may come from another realm.
      if (!('event' in message)) {
        if (phase === 'streaming') controller?.enqueue(new Uint8Array(message));
        return;
      }
      switch (message.event) {
        case 'head':
          if (phase === 'waiting') onHead(message);
          return;
        case 'end':
          controller?.close();
          finish();
          return;
        case 'error':
          fail(new TypeError(message.message));
      }
    };

    const started = invoke<void>('local_http_request', {
      request: {
        id,
        url,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        body: init.body ?? null,
      },
      onEvent: channel,
    });
    started.catch((err: unknown) => fail(new TypeError(errorMessage(err))));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

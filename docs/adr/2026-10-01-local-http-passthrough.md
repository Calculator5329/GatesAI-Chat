# ADR: Ollama and ComfyUI HTTP goes through a Rust pass-through

- Status: Accepted (local-first pass)
- Date: 2026-10-01
- Code: `src-tauri/src/local_http.rs`, `src/services/local/localHttp.ts`

## Context

The desktop app called Ollama and ComfyUI with the webview's `fetch`. That
put three things in the way of "it just works":

- Ollama answers 403 to an Origin it does not know, so an Ollama started by
  systemd, the Ollama app or a remote server needed `OLLAMA_ORIGINS`.
- ComfyUI refuses cross-origin calls unless started with
  `--enable-cors-header`.
- The CSP `connect-src` allows plain http only on loopback, so an Ollama on
  the LAN or a tailnet (`http://192.168.1.20:11434`) was unreachable.

The two existing Rust helpers, `ollama_tags` and `probe_http`, covered only
the model list and the health probe, and both refused anything but loopback.

## Decision

On desktop, every Ollama and ComfyUI HTTP call goes through `localFetch`,
which hands the request to two Tauri commands:

- `local_http_request(request, on_event)` where `request` is
  `{ id, url, method, headers, body }`. It validates, starts the request on
  the async runtime and returns. The response comes back on the channel:
  `{ event: "head", status, statusText, contentType }`, then the body as raw
  byte chunks, then `{ event: "end" }` or `{ event: "error", message }`.
  `localFetch` turns that into a real streaming `Response`.
- `local_http_cancel(id)` aborts the request task, which stops it at once
  even while it waits on a slow model.

What Rust enforces:

- Scheme `http` or `https`; any host.
- No username or password in the URL (the API key travels as a header).
- The normalized path must be one of the Ollama paths `/api/tags`,
  `/api/version`, `/api/chat`, `/api/generate`, `/api/pull`, `/api/delete`,
  `/api/embed`, `/api/show`, `/api/ps`, or the ComfyUI paths `/system_stats`,
  `/object_info`, `/object_info/<node>`, `/prompt`, `/history/<id>`, `/view`,
  `/queue`, `/interrupt`. `<node>` and `<id>` are one segment of ASCII
  letters, digits, `_`, `.` and `-`, never `.` or `..`. No allowed path can
  hold a `%` escape, so an encoded `/`, `\` or dot that a reverse proxy would
  decode (`/history/..%2Fadmin`) is refused. Query strings are allowed and
  not checked; they do not choose the endpoint.
- Method GET, POST or DELETE. Only `Content-Type`, `Accept` and
  `Authorization` headers pass; Origin, cookies and the rest never do.
- Redirects are not followed. Connect timeout 5 s, no overall timeout
  (pulls and generations run for minutes).
- Loopback hosts (`localhost`, 127.0.0.0/8, `::1`) are always reached
  directly, even when `HTTP_PROXY` or `ALL_PROXY` is set. Other hosts honor
  the environment proxy. Both clients are built once at startup and reused,
  so the many polls of one ComfyUI render share kept-alive connections.

Web Lite keeps calling `window.fetch`; nothing changes there.

## Why this does not weaken the security model

- **App code only.** No tool accepts a URL and passes it to `localFetch`.
  Every caller builds the URL from the configured Ollama or ComfyUI base URL
  plus a fixed path. `describe_image` is a model tool, but the model supplies
  only an image path and a question, never the URL. `fetch_page` stays the
  only model-reachable fetcher, with its SSRF guards unchanged.
- **Fixed API paths, any host.** Script running in the webview can call
  these commands too. It can send GET, POST or DELETE to any http or https
  host, but only on the paths listed above, with no redirects, no cookies
  and no headers beyond Content-Type, Accept and Authorization. Any server
  that answers on those paths is reachable, whether or not it is Ollama or
  ComfyUI. Unlike a webview fetch, the response is readable by the page
  without the server sending CORS headers, so the strict per-segment path
  allowlist, not CORS, is the boundary. The CSP already lets that script
  send requests to any https host; the new reach is plain http to a
  non-loopback host, and reading responses CORS would have hidden, on these
  paths only.
- **Less exposure than before.** A managed Ollama used to start with
  `OLLAMA_ORIGINS=*`, which let any web page open in the user's browser drive
  it. That flag is gone because the app no longer needs it.

## What it replaces

- The `ollama_tags` and `probe_http` commands and their loopback-only
  `ensure_local_http_url` check.
- Webview `fetch` in `ollama.ts`, `ollamaPull.ts`, `rag/embeddings.ts`,
  `tools/describeImage.ts` and `local/localRuntimeService.ts`. The ComfyUI
  client moves to `localFetch` in the same pass.
- `OLLAMA_ORIGINS=*` on the managed Ollama process.

## Limits

- Matching is exact, so a reverse proxy that serves Ollama under a path
  prefix (`https://host/ollama/api/chat`) is refused. A proxy at the host
  root works.
- Only `Content-Type` comes back as a response header.
- Live ComfyUI step progress comes from the `/ws` WebSocket, which is not
  HTTP and which the webview opens itself, so it still needs ComfyUI
  started with `--enable-cors-header`. Without the flag the render still
  finishes and the image still arrives through this pass-through; only the
  step counter is missing.

# GatesAI bridge protocol v2

This document specifies the wire contract between the GatesAI Chat desktop
app and the `gatesai-bridge` sidecar. It was audited against the app at
`88cc2888c5b914c47b708fcd5590c42d81b49348` and the sibling bridge repository
at `b3703fab570c3b6af0c9f589e11ab0d7862fc4ce`.

The app-side protocol pin and client are in
[`src/services/bridge/client.ts`](../src/services/bridge/client.ts). The app
connection gate is in
[`src/stores/BridgeStore.ts`](../src/stores/BridgeStore.ts). The bridge-side
canonical message types, protocol version, and operation names are in the
sibling repository at `internal/protocol/protocol.go`; dispatch is in
`internal/server/server.go`.

## Discovery and transport

The default sidecar exposes two loopback endpoints:

- `GET http://127.0.0.1:7331/health` for discovery;
- `ws://127.0.0.1:7331/ws` for protocol messages.

The health response has this shape:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "protocol_version": 2,
  "workspace_root": "/absolute/path/to/GatesAI/workspace",
  "platform": "linux",
  "allowlist": ["git", "python", "node"]
}
```

`version` is the sidecar application version and is independent of the wire
protocol version. The current app records `version`, `workspace_root`,
`platform`, and `allowlist`, but it does not read `protocol_version` from
health. A successful health response is therefore discovery only. The
WebSocket hello exchange is the compatibility gate.

[`BridgeStore`](../src/stores/BridgeStore.ts) polls health every 5 seconds with
a 1.5-second probe timeout. On a successful probe it opens one WebSocket, with
a 3-second connect timeout. After compatibility is established, requests are
multiplexed over that socket by correlation ID. A health failure while online
closes the socket; a socket close rejects every in-flight app request.

### Framing

Each WebSocket message contains exactly one complete JSON object. There is no
newline delimiter, batching, or length prefix above WebSocket framing. The app
sends JSON text with `JSON.stringify`, and the bridge sends WebSocket text
messages. The app ignores inbound binary messages because browser WebSocket
binary payloads are not strings.

The bridge reads complete WebSocket messages and JSON-decodes each one. It
processes requests concurrently, so response order is not guaranteed; `id`
provides correlation. Writes back to a connection are serialized so frames do
not interleave.

The bridge's inbound message limit is:

```text
(max_file_bytes * 4 / 3) + 1 MiB
```

The base64 expansion allows a maximum-sized `fs.write` payload plus envelope
overhead. With the default 50 MiB file cap, the WebSocket message limit is
about 67.7 MiB.

## Version handshake

The app pins `BRIDGE_PROTOCOL_VERSION = 2`. Immediately after the socket opens
it sends the ID-less hello frame:

```json
{ "type": "hello", "protocolVersion": 2 }
```

The bridge recognizes a frame as hello from its `type` field and replies with
its own pin in the same shape:

```json
{ "type": "hello", "protocolVersion": 2 }
```

The hello is a separate message shape, not a request envelope. It has no
`id`, `op`, `data`, or `privileged` field.

The sidecar does not compare the offered client version and does not record
handshake state. Any valid JSON object whose `type` is `hello` receives the
sidecar's current hello response, and the sidecar can dispatch a valid request
even if no hello preceded it. The app provides the fail-closed gate: it accepts
only an integer `protocolVersion` exactly equal to its own pin before changing
the store state to `online` and exposing workspace operations.

Bridges predating hello remain silent. If no valid integer hello arrives in
500 ms, the app classifies the peer as legacy protocol v0. A socket close
during that window also resolves negotiation as v0. Any nonmatching version
causes `BridgeStore` to disconnect the socket, enter `incompatible`, keep
bridge-backed tools unavailable, and show:

```text
Bridge speaks v<bridge>, app needs v2 — update the bridge.
```

There is no range negotiation or downgrade path.

### Compatibility matrix

The implemented compatibility predicate is strict equality:
`bridge hello version === app pin`.

| App pin | Bridge behavior or pin | App detects | Result |
| --- | --- | --- | --- |
| 2 | No hello support / silent peer | 0 after 500 ms | Incompatible; disconnect and request a bridge update |
| 2 | Hello with v1 | 1 | Incompatible; disconnect and request a bridge update |
| 2 | Hello with v2 | 2 | Compatible; store enters `online` |
| 2 | Hello with v3 or any other integer | That integer | Incompatible; disconnect and request a bridge update |
| 2 | Missing or non-integer `protocolVersion` | 0 after 500 ms | Incompatible; disconnect and request a bridge update |
| 2 | Socket closes during hello wait | 0 immediately | Incompatible; request a bridge update |

The request-ID prefix is not a protocol-version signal. The current app emits
`j-1-<counter>` IDs even though it speaks protocol v2. IDs are opaque to the
bridge and may change without changing the wire protocol.

## Message types

After the hello gate, normal traffic uses this envelope:

```text
Envelope {
  id: string
  type: "request" | "event" | "result" | "error"
  op?: string
  data?: any
  privileged?: boolean
}
```

| Type | Direction | Terminal | Meaning |
| --- | --- | --- | --- |
| `hello` | App → bridge, then bridge → app | N/A | ID-less protocol-version advertisement described above |
| `request` | App → bridge | No | Invoke the operation in `op` with the operation-specific `data` |
| `event` | Bridge → app | No | Intermediate event for the correlated request; currently `exec.run` stdout/stderr |
| `result` | Bridge → app | Yes | Successful operation result in `data` |
| `error` | Bridge → app | Yes | Failed operation with `{ "message": string, "code"?: string }` in `data` |

For a request, nonempty `id` and `op` are required by the bridge even though
`op` is optional in the shared serialized struct. `data` is operation-specific.
The bridge ignores unknown JSON fields. It echoes the request's `id` and `op`
in `event`, `result`, and operation `error` responses.

Example request:

```json
{
  "id": "j-1-1",
  "type": "request",
  "op": "fs.read",
  "data": {
    "path": "/workspace/notes/todo.md",
    "encoding": "utf8"
  }
}
```

Example streaming event and terminal success:

```json
{ "id": "j-1-2", "type": "event", "op": "exec.run", "data": { "stream": "stdout", "chunk": "working" } }
{ "id": "j-1-2", "type": "result", "op": "exec.run", "data": { "exit_code": 0, "duration_ms": 42, "stdout": "working\n", "stderr": "" } }
```

Example terminal error:

```json
{ "id": "j-1-1", "type": "error", "op": "fs.read", "data": { "message": "no such file", "code": "operation_failed" } }
```

The app routes `event` data to the matching callback without settling its
promise. `result` resolves the promise with `data`; `error` rejects it as
`BridgeError(message, op, code)`. It does not verify that a response's echoed
`op` matches the original request.

Malformed JSON sent to the bridge produces an uncorrelated `error` with code
`bridge_protocol_error`. A request without `id` or `op` produces the same code.
The app ignores uncorrelated responses, malformed JSON, invalid or missing
types, unknown IDs, and non-text payloads; an affected request remains pending
until a valid terminal frame, its client timeout, or socket close. A
non-`request` envelope sent to the bridge is ignored.

The bridge's on-wire error codes are:

| Code | Cause |
| --- | --- |
| `bridge_protocol_error` | Invalid JSON envelope, or request missing `id`/`op` |
| `fs_denied` | Unprivileged request references protected chat-history paths |
| `operation_failed` | Operation handler error, including an unknown `op` |

`bridge_timeout` is app-local: the client creates that code when its response
timer expires; the bridge never sends it.

### `privileged` request flag

`privileged` is an optional boolean on a `request`. False is omitted from JSON;
only `true` changes bridge behavior. It bypasses the protected chat-history
path gate for app-owned persistence requests. It does not bypass the workspace
path jail, command allowlist, or size limits.

[`src/services/workspaceChatPersistence.ts`](../src/services/workspaceChatPersistence.ts)
is the app facade that sets `privileged: true`. It uses this for canonical chat
state and the readable history mirror under:

- `/workspace/.gatesai/chat/`;
- `/workspace/chat-history/`.

Model-callable tools must never set the flag. Their direct path and command
checks are in
[`src/services/tools/protectedWorkspacePaths.ts`](../src/services/tools/protectedWorkspacePaths.ts),
and list/search results are filtered app-side. Bridge-side enforcement scans
`path` for filesystem requests, `from` and `to` for move/copy, and `cmd`,
`cwd`, `stdin`, `args`, and `env` for execution requests.

The flag is caller-asserted, not an authenticated capability: the current
loopback WebSocket has no client authentication. Its safe use therefore also
depends on the local-only deployment boundary.

## Operations

Question marks below mark optional request or response fields. Field names are
the JSON names implemented by the Go sidecar.

| Operation | Request `data` | Success `data` | App use |
| --- | --- | --- | --- |
| `fs.read` | `{ path, encoding? }` | `{ path, content, encoding, size, mime }` | Yes |
| `fs.write` | `{ path, content, encoding?, append? }` | `{ path, bytes }` | Yes |
| `fs.list` | `{ path, recursive?, max_depth?, max_items? }` | `{ path, entries, truncated? }` | Yes |
| `fs.delete` | `{ path }` | `{ ok: true }` | Yes |
| `fs.move` | `{ from, to }` | `{ ok: true }` | Yes |
| `fs.copy` | `{ from, to }` | `{ ok: true }` | Yes |
| `fs.mkdir` | `{ path }` | `{ ok: true }` | Yes |
| `fs.stat` | `{ path }` | `{ path, kind, size, mtime, mime? }` | Yes |
| `fs.search` | `{ query, path?, max_hits?, max_files?, regex? }` | `{ query, hits, truncated? }` | Yes |
| `exec.run` | `{ cmd, args?, cwd?, env?, stdin?, timeout_ms? }` | `{ exit_code, duration_ms, stdout, stderr, truncated? }` | Yes |
| `exec.kill` | `{ job_id }` | `{ ok: true }` | Implemented by bridge; unused by current app |
| `exec.list` | `{}` | Array of `{ job_id, cmd, args, started_at, status }` | Implemented by bridge; unused by current app |
| `bridge.info` | `{}` | `{ version, protocol_version, workspace_root, allowlist, platform }` | Implemented by bridge; unused by current app |

Operation details that affect interoperability:

- The contract values for `fs.read.encoding` are `utf8` and `base64`; omission
  chooses from the detected MIME type. The bridge base64-encodes only when the
  value is exactly `base64`; another supplied value is echoed as the response
  encoding while the content is sent as a raw string. `fs.write` similarly
  base64-decodes only the exact `base64` value and otherwise treats content as
  text.
- `fs.list` defaults to 500 items and a recursive depth of 10.
- Each `fs.list` entry is `{ path, name, kind, size?, mtime }`; `kind` is
  `file` or `dir`, and `mtime` is Unix time in milliseconds.
- `fs.search.path` defaults to `/workspace`, `max_hits` to 100, and
  `max_files` to 500. Search is case-insensitive substring matching unless
  `regex` is true. Each hit is `{ path, line, snippet }`, with one-based line
  numbers.
- `exec.run` uses the request envelope's `id` as its job ID. Its events have
  `{ stream: "stdout" | "stderr", chunk: string }`. `timeout_ms` is the
  bridge-owned process timeout; omission means no process deadline.
- `exec.kill.job_id` therefore names the `id` of a live `exec.run` request.
- `bridge.info.protocol_version` and health's `protocol_version` are
  informational in the current app. The hello response remains authoritative
  for compatibility.

MCP JSON-RPC methods such as `initialize`, `tools/list`, and `tools/call` are
not bridge operations. HTTP MCP uses fetch; stdio MCP uses Tauri commands, as
described in [`docs/architecture.md`](architecture.md).

## Client timeouts and disconnects

The app's envelope timers are client behavior, not additional wire fields:

- normal request timeout: 30 seconds;
- `timeoutMs: null`: no client-side response timeout;
- `resetTimeoutOnEvent: true`: restart the response timer for each `event`;
- socket close: reject every pending request with `BridgeOfflineError`.

The `terminal` tool sends its optional process timeout as
`data.timeout_ms`. Its client response timer is `timeout_ms + 15 seconds` when
a process timeout is supplied. Otherwise it uses a 600-second idle timer and
resets that timer on every stdout/stderr event. The bridge separately owns
process cancellation and output limits.

## Versioning rules

- `BRIDGE_PROTOCOL_VERSION` in the app and `protocol.Version` in the sidecar
  must be equal for the app to go online.
- The sidecar application version, health status, and `j-1-*` request-ID
  format do not participate in protocol compatibility.
- There is no capability negotiation. A protocol-version bump is a hard cut:
  even a wire-compatible peer with a different integer is rejected.
- Unknown JSON object fields are tolerated in both directions, but this does
  not override the exact hello-version check.
- Changes to message semantics, required fields, operation names, or payload
  shapes must be coordinated across both repositories. Breaking changes
  require updating both pins and packaging a matching sidecar with the app.

Web Lite does not establish this connection. Bridge operations and privileged
workspace persistence are desktop-only; Web Lite must degrade without them.

## Verification sources

App-side envelope behavior is covered in
[`tests/services/bridge/client.test.ts`](../tests/services/bridge/client.test.ts).
The desktop-mocked compatible hello is implemented in
[`tests/e2e/fixtures/harness.ts`](../tests/e2e/fixtures/harness.ts). Bridge-side
health, hello, request correlation, protected-path enforcement, and large
frames are covered in the sibling repository's
`internal/server/server_test.go`.

A release smoke must pair the exact bundled sidecar with the app and confirm
the UI reports `Bridge online`, not merely that `/health` returns `status: ok`.

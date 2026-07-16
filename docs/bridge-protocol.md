# GatesAI bridge protocol v2

The GatesAI desktop app talks to the bundled `gatesai-bridge` sidecar over one
loopback WebSocket at `ws://127.0.0.1:7331/ws`. The app first probes
`http://127.0.0.1:7331/health`; a healthy HTTP response is discovery only, not
proof that the bridge is compatible. The WebSocket hello exchange is the
compatibility gate.

The canonical bridge-side types and operation names live in
`gatesai-bridge/internal/protocol/protocol.go`. This document records the
cross-repo contract consumed by GatesAI Chat.

`src/stores/BridgeStore.ts` owns the app connection lifecycle:

- health probe: `http://127.0.0.1:7331/health`;
- WebSocket endpoint: `ws://127.0.0.1:7331/ws`;
- health poll interval: 5 seconds;
- WebSocket connect timeout: 3 seconds.

Successful health discovery records bridge `version`, `workspace_root`,
`platform`, and `allowlist`. After the protocol gate passes, the store seeds
default workspace guide files and may open the user guide on first install.
When health fails or the socket closes, in-flight requests reject and
bridge-gated tools surface a friendly offline error.

## Connection sequence

1. The desktop app sees a healthy loopback `/health` response.
2. It opens the single `/ws` socket.
3. The app sends:

   ```json
   { "type": "hello", "protocolVersion": 2 }
   ```

4. A compatible bridge answers with the same hello shape and version.
5. Only after an exact version match does `BridgeStore` enter `online` and
   allow workspace operations.

Bridges that predate the hello frame stay silent. After a 500 ms grace window
the client classifies them as protocol v0. A different integer version, a
silent legacy bridge, or a connection closed during negotiation all fail
closed: the socket is disconnected, workspace tools remain unavailable, and
the app reports `Bridge update required` with both versions. GatesAI does not
attempt a best-effort downgrade.

## Request and response envelopes

After negotiation, client requests use an opaque correlation id. The current
`j-1-<counter>` id prefix is an app request-id schema and is deliberately
independent of wire protocol v2:

```json
{ "id": "j-1-1", "type": "request", "op": "fs.read", "data": { "path": "/workspace/notes/todo.md", "encoding": "utf8" } }
```

The bridge echoes `id` and `op` in every response. Long-running operations may
emit zero or more `event` frames before exactly one terminal `result` or
`error` frame:

```json
{ "id": "j-1-1", "type": "event", "op": "exec.run", "data": { "stream": "stdout", "chunk": "working\n" } }
{ "id": "j-1-1", "type": "result", "op": "exec.run", "data": { "exit_code": 0 } }
{ "id": "j-1-1", "type": "error", "op": "fs.read", "data": { "message": "no such file", "code": "operation_failed" } }
```

Unknown ids and malformed frames are ignored. A socket close rejects all
in-flight requests. Requests default to a 30-second client envelope timeout;
selected streaming operations may reset or explicitly disable that timeout.
Those client timers do not grant additional bridge authority.

Envelope fields observed by the app are:

- `id`: client-generated correlation id, echoed by the bridge;
- `type`: `request`, `event`, `result`, or `error`;
- `op`: bridge method name;
- `data`: operation-specific request or response payload;
- `privileged`: optional app-persistence authority described below.

An `event` is routed to the matching request callback without settling its
promise. A `result` resolves it. An `error` rejects with
`BridgeError(message, op, code)`. Frames missing a valid type, malformed
frames, and unknown ids are ignored; an existing request remains pending until
a valid terminal frame, timeout, or socket close arrives.

The v2 operation families are `fs.*`, `exec.*`, and `bridge.info`. Adding an
operation or changing a payload is a cross-repo protocol change and requires
tests on both sides. Breaking wire changes require a protocol-version bump;
application and sidecar release packaging must pin compatible revisions.

### Timeouts

Defaults in `src/services/bridge/client.ts`:

- normal request timeout: 30 seconds;
- `timeoutMs: null`: disables the client-side envelope timeout;
- `resetTimeoutOnEvent: true`: resets the envelope timeout whenever an event
  frame arrives;
- socket close: rejects all pending requests with `BridgeOfflineError`.

The `terminal` tool uses `exec.run` with an idle envelope timeout. If the model
passes `timeout_ms`, the app waits `timeout_ms + 15s`; otherwise it waits up to
600 seconds and resets on stdout/stderr events. The bridge separately owns the
process timeout and kill behavior.

### App-used operations

This inventory comes from app-side `bridge.client.request(...)` calls and
service facades under `src/`:

| Method | App-side use |
| --- | --- |
| `fs.read` | Workspace text/base64 files, attachments, artifact assets, prompt files, and app-owned chat state. |
| `fs.write` | Workspace files, attachments, artifacts, logs, chat snapshots, reports, and generated images. |
| `fs.list` | Workspace directories, skills, chat-history mirror entries, and artifact folders. |
| `fs.delete` | Workspace files/folders, directory resets, and stale chat-history pruning. |
| `fs.mkdir` | Create workspace directories before writes. |
| `fs.move` | Atomic chat-snapshot replacement and model-requested moves. |
| `fs.copy` | Model-requested copies through the `fs` tool. |
| `fs.stat` | File existence/type/size checks for artifacts, guides, and tools. |
| `fs.search` | Workspace substring search and inspect-file artifact lookup. |
| `exec.run` | Allowlisted commands used by `terminal`, `git`, `python_inline`, and `sqlite_query`. |

MCP JSON-RPC methods such as `initialize`, `tools/list`, and `tools/call` are
not bridge methods. HTTP MCP uses fetch; stdio MCP uses Tauri commands
documented in `docs/architecture.md`.

## Security boundary

Protocol compatibility is not authorization. The bridge remains the local
security boundary:

- loopback bind by default;
- workspace path jail and symlink escape rejection;
- explicit executable allowlist;
- file and process-output size limits;
- protected chat-history paths that require the app persistence layer's
  `privileged: true` envelope bit.

Model-callable tools must never set `privileged`. Browser-side checks are
defense in depth and do not replace bridge enforcement.

### Privileged persistence authority

`src/services/workspaceChatPersistence.ts` is the only app-side facade that
sets `privileged: true`. It uses that authority for canonical chat state and
the readable chat-history mirror under these protected trees:

- `/workspace/.gatesai/chat/`;
- `/workspace/chat-history/`.

Generic model tools block direct path and command-text access through
`src/services/tools/protectedWorkspacePaths.ts`, and listing/search results
filter protected entries. The bounded `chat_history` tool is the model-facing
conversation lookup path.

### Workspace assumptions

Model-facing paths use `/workspace/...`; the bridge maps them into the real
local root returned by health. Scripts run from that real root, so tool
instructions use relative paths inside scripts rather than assuming
`/workspace` exists as an operating-system path. Web Lite does not open the
bridge connection and degrades without this desktop-only authority.

## Verification

App-side unit coverage lives in:

- `tests/services/bridge/client.test.ts` for hello negotiation, legacy
  classification, frame correlation, timeouts, and disconnect behavior;
- `tests/stores/BridgeStore.test.ts` for fail-closed incompatible state and
  explicit update guidance;
- `tests/e2e/fixtures/harness.ts` for the compatible v2 desktop-mocked path.

Bridge-side coverage lives in `gatesai-bridge/internal/server/server_test.go`.
A release smoke should pair the exact bundled sidecar with the app and confirm
the UI reports `Bridge online`, not merely that `/health` responds.

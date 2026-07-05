# Bridge Protocol

Observed contract, app-side. The Go bridge is a separate repository; this file
documents only what the GatesAI Chat app sends, expects, and guards from the
app code in this repo.

## Connection

`src/stores/BridgeStore.ts` polls bridge health and owns the app connection:

- Health probe: `http://127.0.0.1:7331/health`
- WebSocket endpoint: `ws://127.0.0.1:7331/ws`
- Poll interval: 5s
- WebSocket connect timeout: 3s

When health succeeds, the app records bridge `version`, `workspace_root`,
`platform`, and `allowlist`, opens the WebSocket, seeds default workspace guide
files, and may open the user guide on first install. When health fails or the
socket closes, in-flight requests reject and bridge-gated tools report a
friendly offline error.

## Envelope

`src/services/bridge/client.ts` sends one JSON envelope per request:

```json
{
  "id": "j-1-1",
  "type": "request",
  "op": "fs.read",
  "data": {},
  "privileged": true
}
```

Fields observed from the app side:

- `id`: generated as `j-<protocol-version>-<counter>`. The app currently uses
  protocol version `1`.
- `type`: outbound requests use `request`; inbound frames are expected to be
  `event`, `result`, or `error`.
- `op`: bridge method name.
- `data`: request payload or response payload.
- `privileged`: optional boolean. Only app-owned workspace chat persistence
  sets this flag.

Inbound handling:

- `event`: routed to the request's optional event callback. Used by `exec.run`
  for streamed stdout/stderr and can reset the request timeout.
- `result`: resolves the request promise with `data`.
- `error`: rejects with `BridgeError(message, op, code)` from `data.message`
  and optional `data.code`.

Malformed frames, unknown ids, and unknown frame types are ignored except a
missing type for a known id, which rejects as `bridge_protocol_error`.

## Timeouts

Defaults in `src/services/bridge/client.ts`:

- Normal request timeout: 30s.
- `timeoutMs: null`: disables the client-side envelope timeout.
- `resetTimeoutOnEvent: true`: resets the envelope timeout whenever an `event`
  frame arrives.
- Socket close rejects all pending requests with `BridgeOfflineError`.

The `terminal` tool uses `exec.run` with an idle envelope timeout:

- If the model passes `timeout_ms`, the app waits `timeout_ms + 15s`.
- Otherwise the envelope waits 600s and resets on every stdout/stderr event.
- The process timeout itself is sent in `data.timeout_ms`; bridge behavior for
  killing the process is bridge-owned.

## Request methods

Generated from app-side `bridge.client.request(...)` calls and bridge service
facades in `src/` during this refresh. The app uses these bridge operations:

| Method | App-side use |
| --- | --- |
| `fs.read` | Read workspace text/base64 files, attachments, HTML artifact assets, image prompt files, and workspace chat state. |
| `fs.write` | Write workspace files, attachments, artifacts, logs, chat snapshots, readable chat history, reports, and generated images. |
| `fs.list` | List workspace directories, skills, chat-history mirror entries, and artifact folders. |
| `fs.delete` | Delete workspace files/folders, reset workspace directories, prune stale chat-history files. |
| `fs.mkdir` | Create workspace directories before writes. |
| `fs.move` | Atomic workspace chat snapshot replace and model-requested file moves. |
| `fs.copy` | Model-requested file copies through the `fs` tool. |
| `fs.stat` | Probe file existence/type/size for artifacts, guides, and `fs stat`. |
| `fs.search` | Workspace substring search and inspect-file artifact lookup. |
| `exec.run` | Run allowlisted workspace commands for `terminal`, `git`, `python_inline`, and `sqlite_query`. |

MCP JSON-RPC methods such as `initialize`, `tools/list`, and `tools/call` are
not bridge methods. HTTP MCP uses fetch; stdio MCP uses Tauri commands
documented in `docs/architecture.md`.

## Privileged flag

`privileged: true` is app-originated only. `src/services/workspaceChatPersistence.ts`
wraps the raw bridge client so all canonical chat-state and readable
chat-history writes are privileged. Model tools do not set this flag.

The protected app-owned workspace trees are:

- `/workspace/.gatesai/chat/`
- `/workspace/chat-history/`

App-side generic tools block those paths through
`src/services/tools/protectedWorkspacePaths.ts`:

- Direct path guards: `fs`, `inspect_file`, `sqlite_query`.
- Command-text guards: `terminal`, `python_inline`, `sqlite_query`.
- Listing/search results are filtered so protected entries do not leak through
  generic directory/search tools.

The model-facing path for conversation lookup is the bounded `chat_history`
tool, not raw filesystem or shell access.

## Workspace assumptions

The app sends model-facing paths as `/workspace/...`. The bridge maps those to
the real local workspace root returned by health. Scripts run from the real
workspace root, so tool descriptions tell models to use relative paths inside
scripts instead of assuming `/workspace` exists as an OS path.

The app treats bridge workspace operations as desktop-only. Web Lite does not
open this connection and must degrade without bridge access.

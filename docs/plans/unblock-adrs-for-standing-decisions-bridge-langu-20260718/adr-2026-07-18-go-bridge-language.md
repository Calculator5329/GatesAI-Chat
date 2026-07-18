# ADR: Companion Go bridge as a separate-repo Tauri sidecar

- Status: Accepted (scheduled re-evaluation — see "Consequences")
- Date: 2026-07-18
- Scope: standing decision, retroactively recorded
- Related: `docs/bridge-protocol.md`, `docs/architecture.md` (Bridge and
  workspace), the active deliberation lane
  `docs/plans/unblock-decide-deliberately-go-bridge-vs-folding-20260718/`

## Context

Desktop workspace, shell/exec, artifact, attachment, and app-persistence
operations that need broad local OS authority are mediated by a companion
process — the `gatesai-bridge` — written in **Go**, living in the sibling
repository `../gatesai-bridge`, bundled as a Tauri sidecar, and reached by the
app over a loopback WebSocket (`ws://127.0.0.1:7331/ws`, protocol version 2).
The Tauri shell already ships a Rust command layer (`src-tauri/`). A recurring
question is therefore why capability is split across two native runtimes (Rust
in-process + Go out-of-process) rather than folded into one.

This ADR records the *standing* rationale so the split is a deliberate,
documented choice rather than an accident of history. It does not itself decide
to keep or fold the bridge; a separate deliberation lane (linked above) owns any
change to the split.

Forces:

- The bridge owns the widest-authority operations (jailed workspace filesystem,
  a shell/exec allowlist, long-running streamed processes). That authority is
  the app's largest attack surface and benefits from process isolation and an
  independent release/audit cadence.
- The app is dual-runtime: desktop (Tauri) **and** browser-only Web Lite. Bridge
  features must degrade gracefully to "disabled/informational" in Web Lite
  (`requireBridge()`), so the boundary is already a hard, testable seam.
- The bridge is reused across contexts (dev via `go run`, prebuilt
  `bin/gatesai-bridge[.exe]` for installs and the Windows worker) and is a
  candidate host for future LAN/companion serving.
- Go gives fast cross-compilation to a static, dependency-light sidecar binary,
  a strong standard-library HTTP/WebSocket/filesystem story, and goroutine-based
  concurrency for streamed exec/watch workloads — with a much lower barrier to
  contribution than async Rust for this class of glue code.

## Decision

The workspace/shell/persistence bridge stays a **separate Go process in its own
repository, bundled as a Tauri sidecar** and spoken to over the versioned
loopback WebSocket protocol. It is not folded into the Rust command layer, and
the Rust layer is not folded into the bridge.

Boundaries that make the split honest:

- **Rust (`src-tauri/`) owns** desktop OS integration that must run in-process
  or needs Tauri APIs: secrets/keychain, global shortcuts, window control, the
  `fetch_page`/`brave_search` network commands, MCP stdio, local-runtime
  probing, source-workspace/build, and the sidecar launch itself
  (`lib.rs` spawns the bridge when present and no bridge already answers
  `http://127.0.0.1:7331/health`).
- **Go bridge owns** the jailed `/workspace/...` filesystem, the exec allowlist
  and streamed terminal output, artifact/attachment I/O, and app workspace
  persistence (`/workspace/.gatesai/chat/...` + readable `chat-history` mirror).
- The contract between them is the documented protocol
  (`docs/bridge-protocol.md`), version-negotiated on connect (a mismatch
  surfaces a typed `BridgeStore` error, never a silent failure).

Cross-repo discipline (already a hard rule in `CLAUDE.md`) is part of the
decision: bridge changes are separate tasks in `../gatesai-bridge`, never edited
from an app-scoped session.

## Consequences

- Two native runtimes to build, ship, and version. Mitigated by the versioned
  handshake, the prebuilt-binary convention, and the Web Lite degrade path.
- The bridge can be audited, sandboxed, and released independently of the app
  shell — the highest-authority code has the clearest blast-radius boundary.
- The seam keeps Web Lite genuinely runnable browser-only; nothing bridge-owned
  can leak into the portable build.
- **Scheduled re-evaluation:** the "Decide deliberately: Go bridge vs folding"
  lane may supersede this ADR. If it decides to fold or re-language the bridge,
  it must land a new ADR that references and supersedes this one; until then
  this decision stands.

## Rejected alternatives

- **Fold the bridge into the Rust command layer.** Collapses the process-
  isolation boundary around the highest-authority operations, couples workspace/
  exec release cadence to the app shell, and raises the contribution bar for
  what is largely I/O glue. The Rust layer intentionally keeps the narrower,
  Tauri-native command surface.
- **Rewrite the bridge in Rust as a standalone sidecar.** Keeps process
  isolation but discards Go's lower contribution barrier and fast static
  cross-compilation for this workload, with no boundary or security gain over
  the current split. Reconsidered only if the two-runtime toolchain cost
  outweighs those benefits — that trade-off is the linked lane's to make.
- **Do everything in the WebView (browser fetch to a loopback server).** Turns
  browser code into a local network proxy, muddies Web Lite/CORS behavior, and
  was already rejected for the narrower Offline Library boundary
  (`docs/adr/2026-07-12-offline-library-plugin.md`).

# Decision: keep the Go bridge as a separate sidecar (do not fold into Rust)

- Task: `unblock-decide-deliberately-go-bridge-vs-folding-20260718`
- Roadmap item: `docs/roadmap.md:665` — "Decide deliberately: Go bridge vs
  folding into a Rust sidecar" (Architecture section)
- Ethan's decision gate: **APPROVED — "You choose best option"** (verbatim)
- Date: 2026-07-18
- Verdict: **Option A — keep the Go bridge as-is**, formalized in an ADR, with
  two cheap hardening follow-ups that capture most of the security benefit the
  fold would have bought.

## The question

GatesAI Chat's model-driven workspace capability (file I/O, exec, search,
git/SQLite/Python) lives in a companion **Go sidecar** (`../gatesai-bridge`),
reached over loopback WebSocket at `127.0.0.1:7331` and bundled by Tauri.
Meanwhile the Rust shell (`src-tauri/`) has grown its own substantial native
surface: secrets/keychain, MCP stdio, SSRF-guarded `fetch_page`, local runtime
spawn, source workspace/build (the self-improvement loop), offline library.
Should the bridge's responsibilities fold into Rust, or stay in Go?

## Options considered

**A. Keep the Go bridge sidecar (status quo, hardened).** Separate process,
separate repo, loopback WS protocol v2, bundled as a Tauri sidecar binary.

**B. Rewrite the bridge as a Rust sidecar.** Same process topology and wire
protocol, one language across native code, still a second binary.

**C. Fold bridge operations into the Tauri app process as commands.** No
sidecar at all; workspace ops become Tauri IPC like `source_workspace_*`.

## Evidence gathered (all verifiable in this repo)

1. **The bridge is finished, specified, and tested.** `docs/bridge-protocol.md`
   (audited 2026-07-16 against both repos) pins protocol v2: hello handshake
   with fail-closed app-side gate, envelope types, 13 operations, privileged
   flag semantics, error codes, size limits. Bridge-side tests cover health,
   hello, correlation, protected-path enforcement, and large frames
   (`internal/server/server_test.go` in the sibling repo). App-side coverage is
   in `tests/services/bridge/client.test.ts`, with more handshake tests already
   spec'd in `docs/plans/unblock-bridge-protocol-doc-version-handshake-fa-20260718/DISPATCH.md`.
2. **The security-critical code is in the bridge.** The workspace path jail
   under `~/GatesAI/workspace/`, the exec command allowlist, protected
   chat-history path enforcement, and output/size limits all live bridge-side
   (`docs/architecture.md` "Workspace sandboxing"). A rewrite re-implements
   exactly the code where a regression is most expensive.
3. **The roadmap leans on a standalone server binary.** Two future items assume
   the bridge is an independent network-capable process:
   - `docs/roadmap.md:683` — "LAN companion: bridge serves Web Lite on LAN with
     pairing code (phone access, data never leaves the network)". A standalone
     HTTP/WS server is exactly what the Go binary already is; a folded-in Tauri
     command surface cannot serve a phone.
   - `docs/roadmap.md:181` — richer terminal is "blocked on a bridge pty op";
     Go's pty story (`creack/pty`) is mature and the change is additive.
4. **Process isolation matters for model-driven exec.** `exec.run` executes
   model-chosen commands. In a sidecar, a hung/crashed/leaking child process
   tree is isolated from the UI process and independently killable
   (`exec.kill` already exists bridge-side). Folding exec into the app process
   (Option C) puts that blast radius inside the window process.
5. **The Go toolchain cost is already sunk and insulated.** End users, CI, and
   the Windows worker all consume a **prebuilt** binary: release CI fetches it
   via `GATESAI_BRIDGE_REPOSITORY` (`docs/architecture.md:82`), the Jordy
   worker and installs use `bin/gatesai-bridge.exe` (CLAUDE.md), and the
   self-improvement build loop rebuilds the app around the existing bridge
   binary — no user or contributor needs Go installed to build the app.
   Binary size (~10 MB) is a one-time installer cost already accepted.
6. **The real weaknesses of the status quo are cheap to fix without a
   rewrite.** `docs/bridge-protocol.md` documents both honestly:
   - The loopback WS has **no client authentication**; the `privileged` flag is
     caller-asserted. Any local process could connect to 7331 and issue
     privileged requests.
   - `src-tauri/src/lib.rs:126` **reuses any process** answering
     `GET /health` on 7331 without verifying it is our bridge or a compatible
     version (the WS hello gate does catch protocol mismatch afterward, so
     this is a smaller gap than it looks — but identity is still unverified).
   - Cross-repo protocol drift — the historical pain — is now controlled by
     the v2 hello handshake (fail-loud, shipped) plus the audited spec.

## Analysis

**Option C is eliminated first.** It is the only option that removes the
unauthenticated loopback surface entirely, which is its one strong argument.
But it forecloses the LAN companion direction, removes exec isolation (4), and
couples model-driven exec to the WebView process lifecycle. It also breaks the
dev flow where a source-run bridge (`go run ./cmd/gatesai-bridge`) is reused by
`tauri:dev`. The security win is achievable another way (below) at a fraction
of the cost.

**Option B buys almost nothing.** A Rust rewrite keeps the same topology, the
same loopback surface, the same protocol — its only durable win is dropping Go
from the *bridge repo's* toolchain (nobody else needs it, per evidence 5) and
one fewer language for maintainers. Against that: days of work re-implementing
and re-testing the path jail, allowlist, protected paths, streaming exec, and
WS server; a security-regression window in exactly the wrong layer; and a
frozen feature roadmap in both repos while the port is in flight. The project's
own heuristic applies: this is a rewrite with **zero user-visible payoff**.
"Simpler is better" cuts the other way here — the *simplest* action is the one
that changes nothing that works.

**Option A wins on every driver except language count:**

| Driver | A: keep Go | B: Rust sidecar | C: fold into app |
| --- | --- | --- | --- |
| Rework cost / regression risk | none | high, in security-critical code | high, plus arch change |
| LAN companion (roadmap 683) | natural fit | natural fit | foreclosed |
| Exec process isolation | yes | yes | no |
| Loopback auth gap | needs token (small, additive) | same gap, needs same token | eliminated |
| Toolchains in play | 3 (Go insulated by prebuilt flow) | 2 | 2 |
| Protocol drift risk | controlled (v2 handshake + spec) | same | gone, but moot |

## Decision

**Keep the Go bridge as a separate sidecar process and repo.** Declare the
bridge language question settled via ADR (which also delivers the "bridge
language" third of roadmap item `docs/roadmap.md:693`, "ADRs for standing
decisions"). Do not schedule any fold or port. Revisit only if a concrete
trigger fires (see ADR text below).

Capture the fold's genuine security benefit through two small additive
hardening items instead of a rewrite:

1. **Spawn-time shared secret for the WS.** The Tauri shell generates a random
   token per launch, passes it to the sidecar (env or `--auth-token` arg), and
   the app presents it at WS connect (query param or first-frame field); the
   bridge rejects unauthenticated sockets. Closes the "any local process can
   issue privileged requests" gap. Cross-repo change → paired lanes, bridge
   half in `../gatesai-bridge`.
2. **Identity check before reusing an existing 7331 process.** The shell's
   `bridge_already_running()` probe should require the health payload to look
   like our bridge (e.g. `status: ok` **and** `protocol_version` present)
   before declining to spawn the bundled sidecar. App-repo-only, tiny.

These are queued as recommendations for the harvesting session, not part of
this decision's DISPATCH (which is docs-only); see DISPATCH.md §"Recommended
follow-on hardening tasks".

## Ready-to-land ADR text

The follow-up task (DISPATCH.md) lands this verbatim as
`docs/adr/2026-07-18-bridge-language-go-sidecar.md`, matching the format of
`docs/adr/2026-07-12-offline-library-plugin.md`:

```markdown
# ADR: Workspace bridge stays a Go sidecar

- Status: Accepted
- Date: 2026-07-18
- Decider: Ethan (delegated: "you choose best option", task
  unblock-decide-deliberately-go-bridge-vs-folding-20260718)

## Context

Model-driven workspace capability (file I/O, exec, search) lives in the
`gatesai-bridge` Go sidecar, reached over a loopback WebSocket speaking
protocol v2 (`docs/bridge-protocol.md`). The Rust shell has meanwhile grown
its own native command surface (secrets, MCP stdio, fetch_page, source
workspace/build). The open question was whether to keep the Go sidecar,
rewrite it as a Rust sidecar, or fold its operations into the Tauri process.

## Decision

The bridge remains a separate Go sidecar process in its own repository. No
port to Rust and no fold into the app process is planned.

Reasons, in order of weight:

1. The bridge's security-critical code (workspace path jail, exec allowlist,
   protected chat-history paths, size limits) is finished, specified, and
   tested; rewriting it maximizes regression risk for zero user-visible gain.
2. The roadmap depends on a standalone server binary: the LAN companion
   (bridge serves Web Lite to phones with a pairing code) and the pty-backed
   terminal are natural extensions of the current process, impossible or
   awkward if folded into the app.
3. Model-driven exec belongs in a separate, independently killable process,
   not the WebView host process.
4. The Go toolchain is invisible to users, contributors, and CI — all consume
   prebuilt binaries (release CI via GATESAI_BRIDGE_REPOSITORY; Windows via
   bin/gatesai-bridge.exe). Language consolidation would benefit only bridge
   maintainers, at the cost of a multi-day freeze and a re-verification burden
   across two repos.
5. Cross-repo protocol drift, the historical cost of the split, is controlled
   by the fail-loud protocol v2 hello handshake and the audited spec.

The known weakness of the sidecar topology — an unauthenticated loopback
WebSocket with a caller-asserted privileged flag — is addressed by additive
hardening (spawn-time shared token; health identity check before reusing a
process on 7331), not by changing the topology.

## Consequences

- Bridge-side work continues as separate tasks in `../gatesai-bridge`; wire
  changes update `docs/bridge-protocol.md` and both version pins together.
- The unauthenticated-loopback hardening items are tracked on the roadmap and
  should land before any feature that widens the bridge's listen scope
  (notably the LAN companion, which must add pairing/auth by design).
- Revisit triggers (any one reopens this ADR): the LAN companion demands
  capabilities Go cannot deliver; the bridge repo becomes unmaintainable;
  Tauri sidecar bundling of foreign binaries breaks on a target platform; or
  a macOS signing/notarization requirement makes shipping a Go sidecar
  materially harder than a Rust one.
```

## What this deliverable does NOT do (lease boundaries)

- Does not edit `docs/roadmap.md` (harvesting session ticks item 665 from
  this folder).
- Does not create `docs/adr/2026-07-18-bridge-language-go-sidecar.md` — that
  path is outside this task's lease; DISPATCH.md specs the task that lands it.
- Does not touch `../gatesai-bridge` (hard rule; both hardening items that
  involve the bridge are spec'd as separate future tasks).

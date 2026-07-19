# DISPATCH — follow-up implementation tasks

Source changes are required in **two repos**; this lane's lease covered only
the plan folder. `design.md` (same folder) is the authoritative design —
read it first. Dispatch order matters:

1. **Hold both tasks** until the concurrent decision lane
   `docs/plans/unblock-decide-deliberately-go-bridge-vs-folding-20260718`
   lands (Go bridge vs folding into Rust). The design is language-agnostic;
   the bridge task below assumes Go and must be re-targeted to
   `src-tauri/` if the fold decision wins.
2. Bridge-side task ships first (its ops are the contract); app-side task
   can be developed against a mocked bridge but must smoke against the real
   binary before done.

## Task spec 1 — bridge repo (SIBLING REPO: `~/projects/ai/gatesai-bridge`)

This is a separate repo per this repo's hard rule ("Don't touch sibling
repos"); dispatch it as its own orchestrator task rooted there.

- **title**: LAN companion listener — pairing, sessions, Web Lite static serving (bridge side)
- **model tier**: smart
- **suggested cap**: $25 (complex multi-file, security-sensitive)
- **goal**: |
    Implement the bridge side of the LAN companion per the app repo's
    docs/plans/unblock-lan-companion-bridge-serves-web-lite-on--20260718/design.md
    (§4 bridge side, §5 pairing flow, §3 threat model — read it first).

    Scope (slices A+B; slice C Ollama proxy is cuttable):
    1. New `internal/companion` package: second `http.Server` (default port
       7332, configurable), completely separate mux from the loopback server.
       Routes: GET/POST /pair (pairing page + code exchange), GET /* (static
       Web Lite assets from a configured dist dir, session-cookie-gated, SPA
       fallback, no-store on index.html), optional /companion/ollama/*
       reverse proxy to 127.0.0.1:11434 (Authorization-bearer-gated,
       streaming, 16 MiB body cap).
    2. Pairing: 6-digit code, 5-min TTL, single-use, invalidated after 5
       failed attempts, constant-time compare, auth failures logged.
       Sessions: 32-byte crypto/rand tokens, SHA-256-hashed at rest in a
       0600 JSON file in the bridge config dir, 30-day expiry, revocable.
       POST /pair sets HttpOnly SameSite=Lax cookie AND returns { token }.
    3. Host-header validation on every companion request: reject unless Host
       is an IP-literal:port matching one of the machine's own private-range
       addresses (kills DNS rebinding); no CORS headers ever.
    4. New loopback-WS ops (protocol version stays 2, additive):
       lan.start { web_dist, port? } -> { url, addresses }, lan.stop,
       lan.status -> { running, url?, devices[] }, lan.pair -> { code,
       expires_at, url }, lan.revoke { device_id }. These must be routable
       ONLY on the loopback server.
    5. Tests (httptest): pairing happy path; rate-limit -> code invalidation;
       expired/reused code; Host validation (hostname and public-IP
       rejection); 401/redirect on unauthenticated asset access; proxy 401
       without bearer; revocation; hashed-token persistence round-trip; and
       an explicit test that the companion mux 404s /ws and /health.
    6. Docs: bridge README section; note in the repo's protocol/ops docs.

    HARD INVARIANT (from the design, non-negotiable): the existing loopback
    WebSocket, /health, workspace jail, exec allowlist, and privileged flag
    gain NO new network exposure. The companion listener shares zero routes
    with the loopback server. Off by default; nothing listens on the LAN
    unless lan.start is called.
- **owns**: the bridge repo (internal/companion/, internal/server/ ops
    dispatch additions, internal/protocol/ op-name constants, config/session
    persistence, tests, README)
- **test-cmd**: `go test ./...`

## Task spec 2 — this repo (app side)

- **title**: LAN companion app side — settings/pairing UI, dist-web resource, companion ops wiring
- **model tier**: smart
- **suggested cap**: $25 (complex multi-file)
- **goal**: |
    Implement the app side of the LAN companion per
    docs/plans/unblock-lan-companion-bridge-serves-web-lite-on--20260718/design.md
    (§4 app side, §5, §7, §8 — read it first). Bridge-side ops land in the
    sibling-repo task; develop against mocks mirroring the design's op
    contracts, and do not edit ../gatesai-bridge from this lane.

    Scope:
    1. Bundle Web Lite as a desktop resource: tauri build runs
       `npm run build:web` with VITE_BASE=./ into dist-web/, added to
       tauri.conf.json bundle.resources; resolve the resource path at
       runtime for lan.start. Keep GitHub Pages deploy untouched.
    2. `src/services/bridge/companionService.ts` (or similar, respecting
       layer boundaries): wraps lan.start/stop/status/pair/revoke via the
       existing bridge client as normal non-privileged requests; maps
       `operation_failed` on lan.* from an older bridge to a distinct
       "companion unsupported — update the bridge" state.
    3. Store slice (BridgeStore or a small CompanionStore wired through
       stores/context.tsx): running/url/devices/pairingCode observables,
       start/stop/pair/revoke actions, status refresh while the settings
       section is visible.
    4. Settings UI, desktop-only via hasDesktopRuntime(): off-by-default
       toggle with the §4 warning copy (unencrypted on your LAN; anyone
       paired gets a private chat app; never port-forward), pairing dialog
       showing URL + 6-digit code with a 5-minute countdown, paired-device
       list with revoke. NO new dependency: if QR rendering needs a lib,
       ship code+URL text only and stop-and-queue the QR dependency
       decision for Ethan.
    5. Insecure-context audit per design §4: verify Web Lite paths never
       assume crypto.randomUUID/subtle or navigator.locks exist (locks
       fallback already exists — add/keep a regression test).
    6. Slice C (cuttable, only if the bridge task shipped its proxy):
       Web Lite offers <origin>/companion/ollama as an Ollama base URL when
       served from a companion origin, using the pairing token from
       localStorage as a bearer header. If cut, add a roadmap checkbox.
    7. New ADR in docs/adr/: "LAN companion listener — moving a bridge
       surface off loopback, opt-in", capturing the design's §1 invariant,
       §3 threat model, §6 TLS decision + revisit trigger.
    8. Tests per design §7: vitest for service+store (incl. unsupported-
       bridge state), settings gating, one desktop-mocked e2e with mocked
       lan.* ops. Web Lite e2e project stays green unchanged.
    9. Docs: architecture.md (security model + new section), bridge-protocol.md
       (new lan.* ops table row + loopback-only note), release-checklist.md
       manual LAN smoke, changelog entry, tick the roadmap item "LAN
       companion: bridge serves Web Lite on LAN with pairing code" with a
       dated note (and the duplicate at the "Later" list line ~395 if still
       present).
- **owns**:
    - src/services/bridge/
    - src/stores/
    - src/components/ (settings + any small shared UI it needs)
    - src/core/runtime.ts (only if a served-from-companion detector is added)
    - src-tauri/ (resource bundling + lib.rs resource path resolution)
    - scripts/ (tauri-build.mjs dist-web step)
    - vite.config.ts, package.json, src-tauri/tauri.conf.json
    - tests/, docs/adr/, docs/architecture.md, docs/bridge-protocol.md,
      docs/release-checklist.md, docs/changelog.md, docs/roadmap.md
- **test-cmd**: `npm run ci && npm run test:e2e` (plus
    `cargo test --manifest-path src-tauri/Cargo.toml` since src-tauri is touched)

## Notes for the dispatcher

- Ethan already approved the feature; no further gate is needed EXCEPT:
  any new dependency (QR lib) is a stop-and-queue, and the ADR must land
  with the app-side task.
- The bridge-vs-Rust-fold decision lane is the only sequencing blocker;
  check its plan folder for the decision before dispatching task 1.
- Done-done for the feature (after both tasks): the design §7 manual smoke —
  a real phone pairs over a real LAN and, if slice C shipped, chats with
  local Ollama with the router's internet disconnected.

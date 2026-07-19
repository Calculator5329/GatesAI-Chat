# LAN companion — bridge serves Web Lite on LAN with pairing code

**Status:** design + threat model (the IDEAS.md #14 "first step"). No source
changes in this lane; implementation is specced in `DISPATCH.md` beside this
file.
**Date:** 2026-07-18. **Decision context:** Ethan approved the roadmap item
(Platforms & compatibility backlog, `docs/roadmap.md` "LAN companion: bridge
serves Web Lite on LAN with pairing code (phone access, data never leaves the
network)").
**Audited against:** app worktree at this lane's checkout; bridge behavior per
`docs/bridge-protocol.md` (audited 2026-07-16).

---

## 1. What this feature is (and is not)

**v1 delivers:** an opt-in, off-by-default mode where the Go bridge opens a
*second, separate* HTTP listener on the LAN that serves the Web Lite static
build to a phone/tablet browser, gated by a short-lived pairing code shown on
the desktop (QR + typeable code). Optionally (slice C) the same listener
reverse-proxies the desktop's loopback Ollama so the phone can chat with local
models — that is the "data never leaves the network" payoff, since the
GitHub Pages copy of Web Lite (https) cannot call a LAN Ollama (http) due to
mixed-content blocking.

**v1 explicitly does not deliver:**

- **Shared chat history on the phone.** The phone gets an independent Web Lite
  instance: its own IndexedDB, its own settings, its own provider keys typed
  on the phone. Desktop chats do not appear on the phone. A "true companion"
  (phone speaks an authenticated bridge protocol and reads
  `/workspace/.gatesai/chat/`) is Phase 2 — see §9.
- **Key sync.** Desktop keychain secrets are never transmitted to the phone.
- **Any workspace/exec capability on the LAN.** See the hard invariant below.
- **TLS.** v1 is plain HTTP on the LAN, risk-accepted with an explicit UI
  warning; analysis in §6.

**Hard invariant (the one non-negotiable):** the existing bridge WebSocket
(`ws://127.0.0.1:7331/ws`) and everything reachable through it — workspace
path jail, `exec.run` with the command allowlist, the caller-asserted
`privileged` flag — stays loopback-only, exactly as today. The protocol doc
already states the `privileged` flag "is caller-asserted, not an authenticated
capability … its safe use therefore also depends on the local-only deployment
boundary." We do not authenticate that surface; we simply never expose it.
The LAN listener is a different `http.Server` with a different mux that has
**no** `/ws` route, no `/health` route (health leaks `workspace_root` and the
exec allowlist), and no bridge-protocol dispatch of any kind. A code-review
checklist item, a Go test, and an ADR (§8) pin this.

## 2. Current state (verified)

- Bridge sidecar is spawned by the Tauri shell with
  `--listen 127.0.0.1:7331` (`src-tauri/src/lib.rs:134`); the app reuses an
  already-running bridge on 7331 in dev.
- Web Lite is a pure static build: `npm run build:web` →
  `vite build --mode web-lite`, `base` overridable via `VITE_BASE`
  (`vite.config.ts`), deployed to GitHub Pages on push to master. It has **no
  server component**; every bridge/Tauri capability is hidden via
  `src/core/runtime.ts` gating.
- Web Locks leader election already degrades to `fallback` when
  `navigator.locks` is absent (`webLocksLeaderElection.ts:113-116`) — which is
  exactly what happens in an insecure (plain-HTTP, non-localhost) context.
- Secrets on Web Lite fall back to `localStorage` (documented in
  architecture.md §Security model) — on the phone this means keys typed there
  live in the phone browser's localStorage, same as visiting the Pages build.

## 3. Threat model

### Assets

| Asset | Where it lives | Exposure change from this feature |
| --- | --- | --- |
| Workspace files + exec capability (RCE-equivalent: allowlist includes `python`, `node`) | Bridge WS on loopback | **None — must stay none.** The invariant in §1. |
| Desktop chat history (`.gatesai/chat/`, `chat-history/`) | Workspace, via privileged WS ops | None in v1 (phone never reads it). |
| Desktop API keys | OS keychain | None (never transmitted). |
| Phone-side chats + keys | Phone browser IndexedDB/localStorage | New, but equivalent to using the Pages build on the phone. |
| Ollama inference traffic (slice C) | Proxied through the LAN listener | New: readable by an on-LAN sniffer (plain HTTP). Risk-accepted, §6. |
| The Web Lite app bundle | Static assets | Public anyway (GitHub Pages); pairing-gating assets is defense-in-depth, not secrecy. |
| Pairing code / session tokens | Bridge memory + config dir (hashed) | New secret material; design below. |

### Adversaries and mitigations

1. **Untrusted device on the same LAN** (roommate laptop, compromised IoT).
   Without a valid session it can reach only: the pairing page and the pairing
   POST. Mitigations: 256-bit session tokens; pairing code is short-lived
   (5 min TTL), single-use, and invalidated after 5 failed attempts (regenerate
   from desktop — brute-forcing a 6-digit code at ≤5 tries is a 0.0005%
   chance); constant-time compare; all auth failures logged to bridge stderr →
   app log. It can also sniff paired devices' traffic (plain HTTP) — §6.
2. **Malicious website open in any browser on the LAN (CSRF / DNS rebinding).**
   A hostile page could POST to `http://<desktop-ip>:7332` or rebind its
   hostname to the LAN IP. Mitigations: (a) Host-header validation — requests
   whose `Host` is not an IP-literal:port matching one of the machine's own
   addresses (or the exact advertised host) get 403; this kills DNS rebinding,
   which necessarily arrives with an attacker hostname in `Host`. (b) The
   Ollama proxy and every state-changing endpoint authenticate via an
   `Authorization: Bearer <token>` header, never via cookie — cross-origin
   pages cannot attach that header without a CORS preflight, and the listener
   sends no CORS headers. (c) Static assets are gated by an `HttpOnly,
   SameSite=Lax` cookie, which is never a state-changing surface.
3. **Off-LAN attacker.** The listener binds to all interfaces by default (a
   multi-homed allowlist is over-engineering for v1) but is only reachable
   off-LAN if the user port-forwards it. UI copy and docs state: LAN only,
   never port-forward, feature is off by default and stops with the app.
   Private-range Host validation also refuses requests addressed to a public
   IP or DNS name.
4. **Stolen/lost phone.** Session token is on the phone. Mitigations: tokens
   are revocable from desktop Settings (per-device list, "revoke"), expire
   after 30 days, and grant only what §1 allows (static assets + Ollama
   proxy) — no workspace access to lose.
5. **Malicious pairing attempt while the code is displayed.** Code is
   displayed only while the Settings pairing dialog is open, single-use, and
   the desktop shows a "device paired: <name/IP>" confirmation, so a hijacked
   pairing is visible and revocable immediately.

## 4. Architecture

### Bridge side (sibling repo `../gatesai-bridge` — separate task, own repo)

New, cleanly separated `internal/companion` package:

- **Listener:** second `http.Server` on port **7332** (configurable),
  started/stopped at runtime by control ops from the loopback WS. Separate mux;
  shares zero routes with the loopback server.
- **Routes:**
  - `GET /pair` — minimal embedded pairing page (code entry form; also reached
    by QR with `?code=` prefilled). No session required.
  - `POST /pair` — `{ code, deviceName? }` → on success: sets session cookie
    (`HttpOnly; SameSite=Lax; Max-Age=30d`) and returns
    `{ token }` JSON for `Authorization`-header use; rate-limited as in §3.1.
  - `GET /*` — Web Lite static assets from the configured dist dir; requires
    the session cookie; unauthenticated hits redirect to `/pair`. SPA
    fallback to `index.html`. `Cache-Control: no-store` on `index.html`.
  - `POST/GET /companion/ollama/*` (slice C) — reverse proxy to
    `http://127.0.0.1:11434`, requires `Authorization` header, streams
    responses, caps request bodies (16 MiB), strips hop-by-hop headers. Ollama
    itself stays loopback-bound and needs no `OLLAMA_ORIGINS` change (the
    proxy makes it same-origin).
- **Control ops on the existing loopback WS** (new `op` values; protocol
  version stays 2 — additive ops are tolerated because unknown-`op` requests
  from old apps simply get `operation_failed`, and old bridges given new ops
  fail the same way, which the app treats as "companion unsupported"):
  - `lan.start { web_dist, port? }` → `{ url, addresses[] }`
  - `lan.stop {}` → `{ ok }`
  - `lan.status {}` → `{ running, url?, devices: [{ id, name, paired_at, last_seen }] }`
  - `lan.pair {}` → `{ code, expires_at, url }` (generates/rotates the code)
  - `lan.revoke { device_id }` → `{ ok }`
  These ops are only routable on the loopback server by construction.
- **Session store:** tokens generated from `crypto/rand` (32 bytes), stored
  **SHA-256-hashed** with device metadata in the bridge config dir (JSON
  file, 0600) so pairings survive restarts; compare by hash lookup.
- **Shutdown:** companion listener stops when the bridge exits (it already
  dies with the app) and on `lan.stop`.

### App side (this repo)

- **Web Lite dist as a resource:** `tauri:build` runs `npm run build:web`
  with `VITE_BASE=./` into `dist-web/`, bundled via `tauri.conf.json`
  `bundle.resources`. At runtime the app resolves the resource path and
  passes it in `lan.start`. (Adds ~a few MB to installers; acceptable.)
- **BridgeStore / service layer:** thin `companionService` wrapping the five
  ops through the existing bridge client (normal, non-privileged requests;
  30 s default timeout is fine). Store slice holds `running/url/devices/
  pairingCode` observable state. Old bridge → `operation_failed` → UI shows
  "update the bridge to use LAN companion" (mirrors the protocol-mismatch UX
  pattern).
- **Settings UI (desktop-only, gated by `hasDesktopRuntime()`):** a "LAN
  companion" section: toggle (off by default), warning copy ("anyone you pair
  gets a private chat app served from this computer; traffic is unencrypted on
  your network; never port-forward this"), QR code + typeable code + URL while
  pairing dialog is open, paired-device list with revoke. QR is rendered
  **without a new dependency**: encode the URL in a canvas via a small vendored
  QR routine is *not* free — if a QR lib would be needed, v1 ships
  code + URL text only and QR becomes a follow-up (dependency additions are a
  deliberate decision per CLAUDE.md; do not buy one silently).
- **Web Lite side:** no behavioral change required for slice A/B. For slice C,
  `LocalRuntimeStore`/Ollama base-URL resolution learns one new case: when
  running as web-lite **and** served from a companion origin (detectable via a
  `/companion/meta` marker or simply same-origin probe of
  `/companion/ollama/api/version` with the stored token), offer
  `<origin>/companion/ollama` as the Ollama base URL with the pairing token
  attached. Token from the `POST /pair` JSON is kept in localStorage.
- **Insecure-context audit (required in v1):** served over plain HTTP,
  `window.isSecureContext === false`: `navigator.locks` absent → existing
  `fallback` path already handles it (verified); `crypto.randomUUID`/`subtle`
  absent → audit Web Lite code paths (the one current `crypto.randomUUID` use,
  `smokeRender.ts`, is artifact/bridge-gated i.e. desktop-only, but add a
  regression test or lint note so a future Web Lite path doesn't assume it).

## 5. Pairing flow (end to end)

1. Desktop: Settings → LAN companion → toggle on. App calls
   `lan.start { web_dist }`; bridge starts the listener and returns its LAN
   URL(s).
2. Desktop: user clicks "Pair a device" → app calls `lan.pair` → shows
   `http://192.168.x.y:7332/pair` + 6-digit code (+ QR if no-dependency
   rendering is available), counting down 5 minutes.
3. Phone: opens the URL (or scans QR), enters/prefills the code, optionally
   names the device.
4. Bridge: validates (rate-limited, constant-time), issues token, sets cookie,
   returns token JSON; page stores the token in localStorage and redirects
   to `/`.
5. Phone now loads Web Lite; desktop shows the new device in the paired list.
6. Later: desktop revokes → next asset/proxy request from that phone gets
   401 → phone lands back on `/pair`.

## 6. TLS on LAN — analysis and v1 decision

Options considered:

| Option | Verdict |
| --- | --- |
| Plain HTTP | **v1 choice.** Honest about the home-LAN threat model; pairing/token still gate access; on-LAN sniffing of phone chat/proxy traffic is the accepted residual risk, stated in the UI. Insecure-context API loss is handled (§4). |
| Self-signed cert per install | Phones show full-page scare warnings on every browser; iOS Safari makes trusting a custom cert a multi-step Settings ordeal. Worse UX than the risk it removes on a home LAN. Rejected for v1. |
| Local CA the user installs on the phone (mkcert-style) | Strictly worse: asks users to install a CA that can MITM *everything* on their phone. Rejected. |
| Real certs via public DNS (Plex `*.plex.direct` pattern) | Needs owned DNS infrastructure + per-install subdomains + ACME; contradicts "no cloud dependency". Deferred indefinitely. |

Revisit trigger: if Phase 2 (real companion with desktop chat history on the
phone) ships, the sniffing asset becomes desktop chat content and TLS moves
from "accepted risk" to "required"; record that in the ADR.

## 7. Testing / acceptance

Bridge (Go, sibling repo): httptest coverage for — pairing happy path;
rate-limit → code invalidation; expired/reused code; Host-header validation
(reject hostname, reject public-IP literal); asset route 401→redirect without
cookie; proxy 401 without bearer token; **a test asserting the companion mux
serves 404 for `/ws` and `/health`**; revocation; hashed-token persistence
round-trip.

App (this repo): vitest for companionService op wiring + store state
(running/pairing/devices/revoke, old-bridge `operation_failed` → unsupported
state); Settings section render-gating (desktop only); insecure-context
regression note per §4. Desktop-mocked e2e: toggle on → mocked `lan.status`
shows URL + paired device (mirrors existing harness bridge mocks). Web Lite
e2e stays green unchanged.

Manual release smoke (docs/release-checklist.md addition): real phone pairs
over real LAN, chats via OpenRouter; with slice C, chats via proxied Ollama
with WiFi-only (router internet unplugged) to demonstrate "data never leaves
the network".

## 8. Gates, sequencing, and dependencies

- **ADR required** (CLAUDE.md: security-model changes need an explicit ADR):
  the implementation lane adds `docs/adr/` "LAN companion listener — moving
  a bridge surface off loopback, opt-in" capturing §1's invariant, §3, §6.
- **Sequencing dependency:** a concurrent lane is deciding "Go bridge vs
  folding into Rust core"
  (`docs/plans/unblock-decide-deliberately-go-bridge-vs-folding-20260718`).
  The HTTP surface, routes, and threat model here are language-agnostic, but
  the bridge-side implementation task must not start until that decision
  lands — if the bridge folds into Rust, `internal/companion` becomes a Rust
  module with the same contract and the control ops become Tauri commands.
- **No new dependency** is assumed anywhere in v1 scope; if the implementer
  concludes one is needed (e.g. QR rendering), that is a stop-and-queue for
  Ethan, not a buy.
- No deploy, no persistence-schema change (phone-side token lives in
  localStorage, not a versioned slot; desktop-side state is bridge-owned), no
  new global keybinds — no card-gate beyond the already-given approval.

## 9. Phasing

- **Slice A (core):** bridge listener + pairing + sessions + static serving;
  app settings toggle/pairing UI + dist bundling + ops wiring; ADR; tests.
- **Slice B:** paired-device list + revoke + persistence across restarts.
- **Slice C (cuttable):** Ollama reverse proxy + Web Lite base-URL wiring.
  If cut, it becomes its own roadmap checkbox.
- **Phase 2 (out of scope, new roadmap item when wanted):** authenticated
  read-only (then read-write) companion protocol so the phone sees desktop
  chat history; requires TLS (§6 revisit trigger), a real capability model
  for the `privileged` flag, and its own design doc.

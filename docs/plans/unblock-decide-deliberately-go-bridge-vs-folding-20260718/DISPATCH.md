# DISPATCH — follow-up task spec

The decision for roadmap item `docs/roadmap.md:665` ("Decide deliberately: Go
bridge vs folding into a Rust sidecar") is made and fully argued in
[`decision-go-bridge-vs-rust-sidecar.md`](./decision-go-bridge-vs-rust-sidecar.md):
**keep the Go bridge as a separate sidecar; no port, no fold.** The only source
change required is landing the decision as an ADR in `docs/` (paths outside
this task's lease). That is this task.

---

## Task spec

- **Title:** Land ADR: workspace bridge stays a Go sidecar
- **Model tier:** fast (mechanical docs landing; the content is pre-written)
- **Owns (lease these paths, edit only these):**
  - `docs/adr/2026-07-18-bridge-language-go-sidecar.md` (new file)
  - `docs/changelog.md` (append one session entry)
- **Do NOT touch:** `docs/roadmap.md` (harvesting session ticks items 665 and
  the "bridge language" third of 693), `docs/bridge-protocol.md`,
  `docs/architecture.md`, any `src/**` or `src-tauri/**`, the sibling
  `../gatesai-bridge` repo.
- **Test command (must be green):** `npm run lint` (docs-only change; full
  `npm run ci` also acceptable but nothing code-bearing is touched).

### Goal

1. Create `docs/adr/2026-07-18-bridge-language-go-sidecar.md` containing the
   ADR text **verbatim** from the "Ready-to-land ADR text" fenced block in
   `docs/plans/unblock-decide-deliberately-go-bridge-vs-folding-20260718/decision-go-bridge-vs-rust-sidecar.md`
   (strip the surrounding code fence; keep everything inside it unchanged).
   Format precedent: `docs/adr/2026-07-12-offline-library-plugin.md`.
2. Append a `docs/changelog.md` entry noting the decision was made and the ADR
   landed, referencing the plans folder for the full analysis.

### Definition of done

1. ADR file exists with the verbatim content; changelog entry appended; no
   other files changed.
2. Lint green; working tree otherwise clean.
3. Report back so the harvesting session can tick `docs/roadmap.md:665` and
   note partial progress on `docs/roadmap.md:693` (ADRs for standing
   decisions — "bridge language" is now covered; "Firestore parked" and
   "updater" remain).

---

## Recommended follow-on hardening tasks (queue separately, not part of this dispatch)

The decision doc identifies two small additive items that capture the security
benefit a fold would have provided. They are independent of the ADR landing and
of each other:

1. **Bridge WS spawn-time shared secret** — *cross-repo, paired lanes.*
   App half (this repo): generate a per-launch random token in
   `src-tauri/src/lib.rs`, pass it to the sidecar spawn args, expose it to the
   frontend, present it at WS connect in `src/services/bridge/client.ts`.
   Bridge half (`../gatesai-bridge`, separate task): accept `--auth-token`,
   reject unauthenticated WS upgrades. Requires a protocol note in
   `docs/bridge-protocol.md` and coordinated rollout (old app + new bridge must
   still pair during transition, or ship both halves in one release).
2. **Health identity check before reusing a process on 7331** — *app-repo
   only, tiny.* `bridge_already_running()` in `src-tauri/src/lib.rs:26` should
   require the health JSON to look like our bridge (`status: "ok"` and
   `protocol_version` present) before skipping the bundled sidecar spawn.
   Owns: `src-tauri/src/lib.rs`, `src-tauri/src/http_health.rs`; test-cmd:
   `cargo test --manifest-path src-tauri/Cargo.toml` + `npm run ci`.

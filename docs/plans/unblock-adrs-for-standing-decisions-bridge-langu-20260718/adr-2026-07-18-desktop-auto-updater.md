# ADR: Signed desktop auto-updater via the public releases repo

- Status: Accepted
- Date: 2026-07-18
- Scope: standing decision, retroactively recorded (implementation shipped
  2026-07-12 as roadmap item W-5)
- Related: `docs/release-checklist.md` (Auto-updater signing),
  `docs/changelog.md` (2026-07-12 W-5), `src-tauri/tauri.conf.json`

## Context

GatesAI Chat ships desktop installers (Windows NSIS, Linux AppImage) built in
CI. The source repository (`Calculator5329/GatesAI-Chat`) is private; release
assets publish to the separate public repo
`Calculator5329/GatesAI-Chat-releases`. Users needed a way to move from an
installed build to a newer one without hunting for a download, but the app is
local-first and privacy-respecting, so an updater must not phone a bespoke
server, must not run unsigned code, and must never update without the user's
say-so.

## Decision

Desktop builds self-update through **`tauri-plugin-updater` +
`tauri-plugin-process`**, pulling a **signed** `latest.json` manifest from the
**public releases repo**, gated behind an explicit user action.

- CI signs updater artifacts with `TAURI_SIGNING_PRIVATE_KEY` (a minisign-style
  Tauri updater key held only in GitHub secrets / the dev box keyfile). The
  matching **public key is pinned in `tauri.conf.json`
  (`plugins.updater.pubkey`)**; the plugin verifies every download against it,
  so an unsigned or tampered asset is refused.
- A `updater-manifest` release job assembles the tag-pinned `latest.json` and
  publishes it to the releases repo. Installed apps poll
  `releases/latest/download/latest.json` on launch and every 6 hours.
- Discovery is surfaced, not forced: a sidebar `UpdatePill` shows
  "vX available — update"; the user clicks to download in the background, then
  confirms relaunch. Failures land in the error trail with a retry offer. There
  is no silent auto-install.
- Version identity is single-sourced by the release process: `package.json` and
  `src-tauri/tauri.conf.json` bump together (enforced by the release checklist).

## Consequences

- Updates require no first-party infrastructure — GitHub Releases is the only
  distribution surface, keeping the local-first, low-cost posture intact.
- The signing key is load-bearing: losing or rotating it breaks the update path
  for installed builds. The release checklist's "setup once, guard forever"
  section owns key custody and the one-time bootstrap (ship a pubkey-pinned,
  manually-downloaded release before the first auto-update can verify).
- The updater is desktop-only; Web Lite is always current by construction and
  has no update surface.
- Final real-world acceptance (an older AppImage updating itself in-app) is
  verified on the first tagged release and tracked under "Verify published
  assets" in the roadmap.
- Windows SmartScreen / unsigned-binary trust and published `SHA256SUMS` are a
  **separate** open decision ("Signed / trusted release builds"), to be recorded
  in its own ADR; this ADR covers only the update-delivery mechanism and its
  update-payload signing.

## Rejected alternatives

- **No in-app updater (manual re-download only).** Simplest, but strands users
  on old builds and undercuts the self-improving-app direction; rejected once
  the release cadence justified an updater.
- **Bespoke update server.** Adds first-party hosting, an always-on dependency,
  and a privacy question, for no benefit over signed GitHub Release assets.
- **Auto-install without confirmation.** Violates the "suggest, never surprise"
  posture and the local-first control expectations; updates stay user-initiated.
- **Ship updater artifacts unsigned.** Would let a compromised release channel
  push arbitrary code to installed apps; pubkey-pinned verification is
  non-negotiable.

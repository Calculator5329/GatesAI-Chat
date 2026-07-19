# Follow-up dispatch: place the three standing-decision ADRs

The three ADRs for this item are finished and live in this plan folder. They
must be moved into `docs/adr/` (outside this lease) and lightly wired in. This
is a small, mechanical docs task — no app/source behavior changes.

---

**Title:** Place standing-decision ADRs (Go bridge, Firestore parked, updater)

**Goal:**
Move the three completed ADRs from
`docs/plans/unblock-adrs-for-standing-decisions-bridge-langu-20260718/` into
`docs/adr/`, keeping their filenames, then add a one-line cross-reference to each
from the relevant `docs/architecture.md` section. Do not alter the ADR bodies
except to fix any relative link that breaks after the move.

Steps:
1. Copy these into `docs/adr/` (drop the `adr-` filename prefix to match the
   existing `docs/adr/2026-07-12-offline-library-plugin.md` convention):
   - `adr-2026-07-18-go-bridge-language.md` → `docs/adr/2026-07-18-go-bridge-language.md`
   - `adr-2026-07-18-firestore-parked-cloud-sync.md` → `docs/adr/2026-07-18-firestore-parked-cloud-sync.md`
   - `adr-2026-07-18-desktop-auto-updater.md` → `docs/adr/2026-07-18-desktop-auto-updater.md`
2. In `docs/architecture.md`, add a single "See `docs/adr/…`" pointer to each of:
   the "Bridge and workspace" section (Go bridge ADR), the "Persistence"
   section (Firestore-parked ADR), and the "Rust layer" or a release note (updater
   ADR) — mirroring how the Offline Library ADR is already referenced at
   `docs/architecture.md:621`.
3. Verify all relative links in the three ADRs resolve from their new location
   (they reference sibling `docs/adr/…`, `docs/bridge-protocol.md`,
   `docs/release-checklist.md`, `docs/changelog.md`, `docs/purpose.md`,
   `src/services/persistence/`, `src-tauri/tauri.conf.json`).
4. Append a one-line `docs/changelog.md` entry noting the three ADRs landed.
5. Remove the drafts from this plan folder (or leave a stub pointing at
   `docs/adr/`), per the harvesting session's preference.

**Owns:** `docs/adr/`, `docs/architecture.md`, `docs/changelog.md`,
`docs/plans/unblock-adrs-for-standing-decisions-bridge-langu-20260718/`

**Test-cmd:** `npm run lint`
(docs-only; lint must stay green. No new source, so `npm test`/`typecheck`
are unaffected. Optionally spot-check rendered links.)

**Not in scope:** the repo-visibility ADR and the signed/trusted-Windows-release
ADR — those are separate roadmap items with their own leases.

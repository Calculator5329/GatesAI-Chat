# Demo production plan — "The app edits itself, rebuilds, and asks to update"

**Roadmap item:** "Record the self-improvement demo (app edits itself, rebuilds,
asks to update) once the loop closes" (docs/roadmap.md, Visions / Later).
**Ethan's decision:** APPROVED.
**Lane:** `unblock-record-the-self-improvement-demo-app-edi-20260718`.
**Status of this deliverable:** design/execution plan + owner-action packet.
Recording is an owner-only action (needs a real screen + narration on the
signing machine); this document is the shooting script Ethan follows.

---

## 1. Verdict: the loop is closed — this is recordable today

The item is gated on "once the loop closes." As of v4.7.0 every stage the demo
narrates is shipped and wired to a **real, user-visible UI affordance** (not a
mockup). Verified against source in this worktree:

| Loop stage | Mechanism (shipped) | User-visible affordance |
| --- | --- | --- |
| **Edits itself** | `source_workspace` tool — `status`/`prepare`/`list`/`read`/`write`/`edit`/`search` over an **app-managed duplicate** of GatesAI's own source (`src/services/tools/sourceWorkspace.ts`, `src/services/sourceWorkspace.ts`, `SourceWorkspaceStore`). Always offered on the desktop runtime (`registry.ts` selects `source_workspace` + `source_build` whenever `desktopRuntime !== false`). | Workspace menu: source status, **changed-files list, per-file diff, per-file revert** (`src/components/menu/sections/Workspace.tsx`). |
| **Rebuilds** | `source_build` tool — `test` (`npm ci`→`npm test`+`typecheck`+`lint`), `build` (`npm run build`), `package` (`npm run tauri:build`), one job at a time (`src/services/tools/sourceBuild.ts`). Recommended workflow baked into the tool description: *edit → test → fix → test → build*. | Workspace menu **SourceBuildCard**: live step status + tail logs, and **"Open output folder"** on build success. |
| **Asks to update** | Signed Tauri auto-updater W-5 (shipped v4.6.0): `tauri-plugin-updater` + `tauri-plugin-process`, CI-signed artifacts, `latest.json` on the public `Calculator5329/GatesAI-Chat-releases` repo (`src/services/updates/appUpdater.ts`, `UpdateStore`). | Sidebar **UpdatePill** (`src/components/editorial/UpdatePill.tsx`): `available → downloading…% → restart to finish updating`, click-to-install / click-to-relaunch, ×-dismiss. |

**Important honesty boundary (drives the whole shoot):** the on-camera
`source_build package` produces a **local signed installer**. It does *not*
publish a GitHub release, and the app never auto-installs its own freshly-built
artifact — by design the tool "does not install the generated installer or
modify the live app… the user must choose and approve any install/update"
(`sourceBuild.ts`). So the last beat, "asks to update," has two truthful
framings; **pick one before shooting** (§4). Do not stitch a fake continuous
take that implies the app silently swallowed its own build.

---

## 2. The demo change (exact, pre-chosen: fast, safe, visible, reversible)

A good on-camera self-edit must be (a) *visibly* about the app changing itself,
(b) test-safe so `source_build test` goes green on the first take, (c) fast, and
(d) trivially reverted. **Chosen change: add a dated line to the app's own
in-app What's-New / changelog surface** — the app literally writing its own
release notes is the most on-message possible edit.

- **Primary target:** append one entry to `docs/changelog.md` in the duplicate
  source (pure content, cannot break the 995-test vitest suite, typecheck, or
  lint — it is not compiled). This guarantees a green `test` run on camera.
- **Optional "you can see it in the running app" upgrade:** also edit the
  What's-New panel data source so the new line renders in the rebuilt app.
  Before shooting, confirm the exact file with
  `source_workspace search "what's new"` / `grep -rn "whats.new\|what-new\|whatsNew" src` and pick the **data/array entry**, not a snapshot-tested
  component, so tests stay green. If that surface is snapshot-tested, keep the
  demo change to `docs/changelog.md` + the visible-string tweak below.
- **Backup visible change (if you want an unmistakable pixel diff):** change one
  cosmetic string the app shows about itself (e.g. a footer/among-tagline
  string). Verify it is **not** asserted in a snapshot/e2e test first
  (`grep -rn "<the string>" src tests`). If it is, either update the test in the
  duplicate too (agent can do this on camera — it *is* the point) or fall back
  to changelog-only.

**Why not a functional feature edit on camera:** real feature work risks a red
test take and a long debugging detour. The demo's message is *the loop*, not the
feature. Keep the diff a handful of lines. Reversibility: the Workspace menu's
per-file revert (and `git` in the duplicate) undoes it in one click between
takes.

---

## 3. Storyboard (three acts, ~2–3 min final cut)

Narration is written to be spoken. `→` marks an expected tool call the viewer
sees stream in the chat.

### Act 0 — cold open (10s)
> "This is GatesAI Chat. Watch me ask it to change its own source code, rebuild
> itself, and hand me a new installer — all from the chat box."

Frame: app open, sidebar visible (so the UpdatePill area is in-shot later),
Workspace menu reachable.

### Act 1 — the app edits itself (40–60s)
**Prompt to type (verbatim):**
> "Open your own source workspace and add a changelog entry dated today that
> says you edited yourself live during a demo. Show me the diff before building."

Expected on-camera sequence:
1. → `source_workspace { action: "status" }` — reports bundled snapshot + prepared duplicate location.
2. → `source_workspace { action: "prepare" }` *(only if status says missing/stale — pre-prepare before the take to skip the copy wait; see §5)*.
3. → `source_workspace { action: "read", path: "docs/changelog.md" }`.
4. → `source_workspace { action: "edit"/"write" }` appending the dated entry.
5. Agent stops and says it's ready; **cut to the Workspace menu** and show the
   **changed-files list → the diff** for `docs/changelog.md`. Narrate: "That's a
   real diff in a real duplicate of its own codebase — nothing hidden."

### Act 2 — it rebuilds itself (60–90s, time-compressed)
**Prompt:**
> "Run your tests, and if they pass, build a new installer."

Expected sequence:
1. → `source_build { action: "start", command: "test" }` → cut to the
   **SourceBuildCard live logs**; show steps go green (`npm test`, `typecheck`,
   `lint`). Narrate over a **hard cut / speed-ramp** — do not sit through the
   full run.
2. → `source_build { action: "start", command: "package" }` (`npm run
   tauri:build`). **Time-compress hard** (this is minutes). Show the card reach
   success with an `installer_path`.
3. Agent hands off: → `source_build status` shows `installer_path` /
   `installer_bytes`; the app offers **"Open output folder."** Click it; show
   the freshly-built signed installer file on disk.

> "It just tested and rebuilt itself and produced a signed installer. It did
> **not** install it — that's my call."

### Act 3 — it asks to update (30–45s) — choose ONE framing in §4
Show the **UpdatePill** doing the asking, then relaunch into the changed app and
point at the new changelog line. End card:
> "The app improved itself, and asked permission before shipping. Local-first,
> reviewable, reversible."

---

## 4. The "asks to update" beat — two honest framings (pick before shooting)

The updater pill is driven by a **published release** with a higher version in
`latest.json`, not by the local `package` job. Do not imply otherwise. Options:

- **Framing A — "reviewable self-build" (single machine, fully self-contained,
  recommended for a quick honest cut).** After Act 2, **double-click the
  installer the app just built** and let the OS installer run; relaunch GatesAI;
  show the new changelog line live. The "asks to update" beat is the app's own
  handoff ("ready to build / open output folder / your call to install"). Most
  truthful to what one machine actually does end-to-end; no release plumbing.

- **Framing B — "full auto-update loop" (shows the literal UpdatePill).**
  Pre-stage a real signed release one patch above the running build on the
  `GatesAI-Chat-releases` repo (normal `v*` tag flow — Ethan-only, done *before*
  the shoot, off-camera). Run the app one version behind. When it boots it
  polls, and the **UpdatePill** appears: `available → downloading…% → restart to
  finish updating`; click through and relaunch. This is the most cinematic but
  requires a release publish and a version-behind build staged in advance.

Either way the through-line is honest: **edit (real) → test+build (real) →
install with explicit consent (real).** Recommend recording **Framing A** first
(it needs nothing but this machine), then Framing B as a follow-up if a
polished "the pill literally pops up" shot is wanted for marketing.

---

## 5. Owner-action packet — how Ethan records it

Recording needs a real screen-capture + narration on the **signing dev machine**
(`~/projects/ai/gatesai-chat`), and Framing B additionally needs a release tag —
both owner-only. Agents cannot capture the screen or publish releases.

**5a. What this changes / produces:** a screen-recording file (the demo video)
and, for Framing B only, one new signed public release tag. No change to app
source lands from the shoot itself (the on-camera edit lives in the *duplicate*
source workspace and is reverted after).

**5b. Why the agent can't do it:** screen+mic capture requires a desktop session
and Ethan's narration; publishing a release tag is Ethan-only per workspace git
policy (deploys/releases are card-gated).

**5c. Pre-flight checklist (do these off-camera, then start recording):**
```sh
# 1. Build & run the current desktop app from the signing checkout.
cd ~/projects/ai/gatesai-chat
# bridge sidecar (separate terminal, from the sibling repo):
#   cd ../gatesai-bridge && go run ./cmd/gatesai-bridge   # or use bin/gatesai-bridge
npm run tauri:dev            # or install a fresh tauri:build so it's the "real app"

# 2. Warm the loop so the take has no dead air:
#    - In the running app, open Workspace menu → Prepare source workspace
#      (or let Act 1 do it; pre-preparing removes the copy wait on camera).
#    - Confirm `npm ci` deps for the duplicate are warm: run `source_build test`
#      once off-camera so the on-camera test run is fast and green.

# 3. Pick & pre-verify the visible demo change is test-safe (see §2):
grep -rn "whats.new\|what-new\|whatsNew\|What's New" src        # find the panel data source
#   -> confirm your target line is NOT in a snapshot/e2e assertion before editing on camera.

# 4. FRAMING B ONLY (off-camera, Ethan-only): stage the release one patch ahead.
#    Bump package.json + src-tauri/tauri.conf.json, tag v<next>, let CI sign & publish,
#    confirm latest.json updated on Calculator5329/GatesAI-Chat-releases.
#    Then run a build ONE version behind so the pill has something to offer.
```

**5d. Expected success signals on camera:**
- Act 1: `source_workspace` diff renders in the Workspace menu changed-files view.
- Act 2: SourceBuildCard shows all `test` steps `exit=0`, then `package`
  succeeds with a non-empty `installer_path`; "Open output folder" reveals the file.
- Act 3A: relaunched app shows the new changelog line. Act 3B: UpdatePill cycles
  `available → downloading → restart to finish updating`.

**5e. Undo / cleanup after the shoot:**
- Revert the on-camera edit: Workspace menu per-file **revert** (or discard the
  duplicate source workspace). Nothing lands in the real repo from the demo edit.
- Framing B leaves a real published release — that's a genuine version bump, so
  only stage it if you intend to ship that version; otherwise use Framing A.

**5f. What to return so downstream work can resume:** the recorded file path (put
it at a durable location, e.g. `docs/media/` or the releases repo assets, **not**
`~/.cache`/tmp), so README/handbook can deep-link it. Then the roadmap item can
be checked off and a review card emitted.

---

## 6. Honesty & safety rails (must hold in the final cut)

Per repo direction and the AP-4 design's "honest client-side loop," the video
must not overclaim:

- **No hidden changes.** Always show the diff/changed-files before building; the
  tool itself forbids claiming changes are hidden.
- **No silent self-install.** The app builds an installer; a human approves the
  install/update. Do not cut the take to imply autonomous self-replacement.
- **No "the model learned/retrained."** This demo is source self-editing +
  rebuild, *not* weight training. If narration mentions "self-improvement,"
  keep it to "edits its own code and rebuilds," not "gets smarter on its own."
- **Duplicate, not live source.** Edits happen in the app-managed *duplicate*
  workspace; the running app's installed files are untouched until an approved
  install. Say so.
- **Real runs only.** Time-compress long steps with visible cuts/speed-ramps;
  never fabricate a green test result or a fake log tail.

---

## 7. Why no code DISPATCH.md

Recording the demo **requires no source changes** — every affordance the script
uses already ships (§1), verified in this worktree. Therefore this lane produces
a plan + owner-action packet only; there is no follow-up implementation task to
dispatch. The harvesting session should tick the roadmap item from this
deliverable and hand the owner-action packet (§5) to Ethan via the queue/card
flow so he can shoot it.

**Optional, non-blocking enablers (nice-to-have, NOT required to record):**
- A one-command "demo warm-up" script that pre-prepares the source workspace and
  runs a throwaway `source_build test` so a take has zero dead air. Small, could
  live under `scripts/`.
- A tiny, guaranteed-test-safe "demo edit" fixture line the agent can be pointed
  at, to remove any doubt about picking a snapshot-tested string on camera.

If Ethan wants either enabler, it becomes its own small lane (title:
"Add demo warm-up script for the self-improvement recording"; owns: `scripts/`
+ this plan dir; test-cmd: `npm run ci`). Not filed here because the demo is
recordable without them.

---

## 8. Acceptance criteria for "item done"

1. A recorded video exists at a durable path showing, in order: a real
   `source_workspace` diff, a green `source_build test`, a successful
   `package`/build with an installer artifact, and an explicit human-approved
   update/relaunch into the changed app (Framing A or B).
2. The cut honors every rail in §6 (no hidden change, no silent self-install, no
   retraining claim).
3. README/handbook (or releases page) links the video; roadmap item checked off
   with a dated note; a review card emitted for Ethan.

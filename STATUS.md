# STATUS — v2 UI taste-pass lane

Branch `ui/taste-pass-20260726`, worktree `.claude/worktrees/taste-pass`.
Pushed to origin. **Not merged, not deployed.**

Ethan asked to keep iterating this lane until **21:00 local** on 2026-07-26,
working down the list below. Every item ships only behind the full gate:
`npm run ci` + `npm run test:e2e`, and `npm run screens:tour` when a surface
changes.

## Done

- `efe6bd0` motion tokens: easing was baked into `--motion-fast/fade`, which
  silently killed four entrance animations and the thread-switch view
  transition. Also the white artifact hole, focus ring, jump-pill repaint.
- `3982766` v2 chat shell: Settings button in the sidebar foot, transcript
  rhythm, `HtmlArtifactPreview` variant prop, new-conversation polish.
- `ecb97cd` **fixed a defect in 3982766**: the variant prop was added but never
  passed at any of the four transcript call sites, so the 420px panel frame was
  still rendering. Also gave fenced HTML documents a compact card.
- `e859272` toggle press animation, switch naming, dead focus CSS.

## Queue

- [x] **B. Cancelled agent tasks read as Failed after a reload.** *(done)*
      Added a persisted `Thread.agentTaskCancelled`, written by
      `AgentTaskLifecycle.cancel` and cleared on retry; `TaskStore` reads it
      instead of the in-memory Set. Additive and optional, so old snapshots
      read as not-cancelled, which is exactly the pre-fix behaviour and needs
      no migration. Four regression tests: two in TaskStore (cancelled vs
      self-interrupted after a reload) and two in persistence (round-trip plus
      an older snapshot).
- [~] **C. Motion leftovers from the audit.** *(toast done; dock deferred)*
      Undo toast now enters and exits: it mounts un-shown, marks itself shown
      on the next frame, and stays mounted through a 160ms exit instead of
      vanishing the instant the timeout fires. Three tests defend it.
      **Dock collapse is NOT done and is not a CSS fix**: `DockPanel` renders
      the collapsed rail and the expanded panel as two different branches, so
      the element unmounts and remounts and there is nothing for a width
      transition to cross. Animating it means unifying them into one root with
      a class toggle, which moves `data-testid` around and touches
      `dock.spec.ts`. Worth doing, but as its own change.
- [x] **D. Transition token adoption.** *(done, and smaller than the audit said)*
      The audit's "31 of 49" counted `services/chat/libraryExport.ts`, which
      generates a standalone HTML document with no access to the app's custom
      properties, so its `.15s` values are correct as written and were left
      alone. The genuine in-app offenders were six declarations: three in
      Lightbox (0.18s x2, 0.12s), one 120ms rule in editorial.css, and the
      180ms task-center progress bar, which got its own named
      `--motion-progress` token because a progress bar that snaps reads as a
      glitch rather than as progress.
- [x] **E. Settings dead code.** *(done)* Removed the `supported`/"Coming soon"
      machinery from `menuSectionMeta` and `GatesMenu` (every section is
      supported, so the disabled-tab styling, the badge and the fallback lookup
      could never render), and `ProviderCard`'s `needsBaseUrl` branch, a
      leftover from the retired openai-compat provider. Section labels were
      also duplicated in two files in two different orders; they now live in
      `core/menuSections.ts`, because the ESLint layer rule correctly refuses
      to let the editorial sidebar import from components/menu.
      The eight unwired `UiPrefsSnapshot` fields are NOT dead:
      `animationsEnabled` drives the animation kill-switch. Left alone.
- [ ] **A. Task center on Web Lite.** `DockStore.available` is desktop-only,
      but `task-center` is the one panel with `requiresBridge: false`. This is
      what blocks the agent-tasks move: today the dock version is strictly
      richer but does not exist on Web Lite or mobile, so a straight move would
      delete agent tasks from those runtimes.
- [ ] **F. Follow-up while streaming.** Design doc first. This is turn-pipeline
      work in `ChatStore`, not styling: a queue that survives a streaming turn,
      a delivery point at a safe boundary, a resume path, and reconciliation
      with in-flight tool calls. Three options are live in the harness.

## Blocked on Ethan

- Settings restructure: needs a grouping picked (by object / by frequency /
  by subsystem as today). Switchable in the harness.
- Whether agent tasks move out of the sidebar at all, once A unblocks it.
- Merge to master.

## Owner action

**Two Electron apps have eaten the entire inotify budget**, measured
2026-07-26 14:50 local by summing `inotify wd:` lines across every `/proc/*/fdinfo`:

| pid | process | watches |
|---|---|---|
| 980417 | electron (openai-codex-desktop) | 1,094,804 |
| 1348783 | cursor | 1,000,030 |
| | **total** | **2,094,834 of 2,097,152 (99.89%)** |

That leaves 2,318 watches for everything else, so any vite dev server dies with
`ENOSPC` before it finishes booting, in every lane on this box. It is not one
leaking app, it is two, and restarting only one may not be enough.

Worked around in-repo: `vite.config.ts` now honours `GATESAI_WATCH_POLL=1`,
which switches the watcher to polling. Opt-in, off in CI, costs CPU. Run e2e
with `GATESAI_WATCH_POLL=1 npm run test:e2e` on this machine.

Real fix is restarting those two apps, or raising the ceiling:

```sh
# inspect
cat /proc/sys/fs/inotify/max_user_watches
# raise for this boot only
sudo sysctl fs.inotify.max_user_watches=524288
# persist
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/90-inotify.conf
```

Agents have no sudo on this box, so this one needs your hands. Success looks
like a dev server starting without ENOSPC and without the polling workaround.

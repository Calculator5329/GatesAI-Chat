# STATUS — v2 UI taste-pass lane

Branch `ui/taste-pass-20260726`, worktree `.claude/worktrees/taste-pass`.
Pushed to origin. **Not merged, not deployed.**

Ethan asked (2026-07-26 ~03:55 local) to keep iterating this lane until 07:00
local, working down the list below. Every item ships only behind the full gate:
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
- [ ] **D. Transition token adoption.** 31 of 49 `transition:` declarations use
      hand-written durations. Six ad-hoc values orbit the two tokens
      (`.15s`, `.18s`, `120ms`, `.2s`, `180ms`, `0.12s`) with no perceptible
      difference and no upside.
- [ ] **E. Settings dead code.** The `supported`/"Coming soon" badge machinery
      is unused; `ProviderCard`'s `needsBaseUrl` branch is unreachable because
      the only caller passes `false`. (The eight unwired `UiPrefsSnapshot`
      fields are NOT dead: `animationsEnabled` drives the kill-switch. Leave.)
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

`openai-codex-desktop` (pid 980417) is leaking inotify watches, about 1.09M of
the 2097152 per-user ceiling, which makes vite dev servers die with ENOSPC.
Workaround in use: `server.watch.usePolling`. Real fix is Ethan restarting that
app, or raising the ceiling:

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

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
- [x] **C. Motion leftovers from the audit.** *(done)*
      Undo toast now enters and exits: it mounts un-shown, marks itself shown
      on the next frame, and stays mounted through a 160ms exit instead of
      vanishing the instant the timeout fires. Three tests defend it.
      **Dock collapse now animates too.** The two render branches are unified
      into one persistent root, so width can transition between the rail and
      the panel. The transition is suppressed while the resizer is being
      dragged, because easing direct manipulation just makes it feel laggy.
      `data-testid` still switches between `dock-panel` and
      `dock-collapsed-rail`, so `dock.spec.ts` needed no changes.
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
- [x] **G. QA-1 settings walkthrough.** *(done, and it found a live bug)*
      `tests/e2e/settingsWalkthrough.spec.ts` drives each persisted setting,
      changes it, reloads and asserts it survived. First run found that the
      **theme switcher never worked**: `setTheme` was missing from UiStore's
      `action.bound` list, so Settings passing `ui.setTheme` straight to
      SegmentedControl's `onChange` called it with no receiver and it threw
      `Cannot set properties of undefined (setting 'theme')`. Clicking
      Dark/Light/System did nothing. Audited every other setter passed as a
      bare prop; `setTheme` was the only hole. Unit test asserts the whole set,
      and was confirmed to fail with the fix reverted.
      *Extended:* saved facts (add, persist, delete, stay deleted), the Ollama
      address, and a guard that clicking any setting throws nothing in the
      page, which is the class of failure the theme bug belonged to. One test
      title claimed Web Lite coverage the desktop-only project cannot provide;
      the claim now lives in `web-lite.spec.ts`, where it asserts the
      desktop-only switches are absent rather than inert. e2e 28 -> 37.
- [ ] **A. Task center on Web Lite.** *(investigated, deliberately not done)*
      Wiring the unread `requiresBridge` flag turned out to be the wrong fix:
      every dock panel already handles bridge-offline with its own specific
      notice ("Bridge offline." in FileExplorerPanel, and so on), which is more
      useful than a generic gate would be. The remaining change is purely a
      product decision about whether the dock should exist on Web Lite at all,
      so it stays here rather than being made unilaterally. `DockStore.available` is desktop-only,
      but `task-center` is the one panel with `requiresBridge: false`. This is
      what blocks the agent-tasks move: today the dock version is strictly
      richer but does not exist on Web Lite or mobile, so a straight move would
      delete agent tasks from those runtimes.
- [x] **F. Follow-up while streaming.** *(design done, implementation not started)*
      `docs/plans/2026-07-26-follow-up-while-streaming.md`. Key finding: sending
      mid-stream is **already** a hard interrupt today
      (`chatTurnEngine.ts:90-93`), so this changes a default rather than adding
      a capability, and the existing interrupt path becomes the double-Enter
      escape hatch unchanged. The safe delivery point is the gap between
      provider rounds in `turnRunner.ts:231`, which bounds the wait at one
      round. **One fork needs Ethan**: queue-then-deliver (recommended, has an
      undo) vs post-now-then-mark-read (calmer, cannot be taken back).

- [x] **H. Hover feedback on dismiss affordances.** *(done)*
      The motion audit flagged that many inline-styled clickables carry
      `cursor: pointer` and nothing else. Most turned out to be covered by the
      big shared selector lists in `editorial.css`; the genuine gaps were the
      update-pill dismiss, the update-pill label when it is a button, and the
      What's New close. All three now share one `.quiet-dismiss` class added to
      the existing transition and hover lists, rather than gaining a fourth,
      fifth and sixth bespoke rule.

- [x] **I. Three tools were showing users their raw registry names.** *(done)*
      `recall`, `spawn_task` and `logs` had no `TOOL_UI` entry, so they fell
      through `defaultToolUi`'s generic branch and rendered as "Using recall",
      "Using spawn task" and "Using logs" in the transcript. `docs/taste.md`
      says the opposite: "Lead with the goal in plain English ... not raw tool
      syntax." They are now "Searching memory", "Starting/Scheduling a
      background task" and "Reading app logs", with the query, task title and
      log scope as targets.
      The existing test claiming "ambient labels for every registered tool"
      could not have caught this, because the generic fallback also supplies a
      verb. Added one that asserts no registered tool resolves to the bare verb
      'Using', and confirmed it fails when a label is removed.

- [x] **J. Message containment jank.** *(investigated, no change needed)*
      The audit suspected `contain-intrinsic-size: 0 200px` would cause rows to
      jump. Real rows measure 111-253px, so the estimate is wrong, but Chrome
      applies last-remembered-size automatically for `content-visibility: auto`
      and computes the same `auto 0px auto 200px` whether or not `auto` is
      declared. Verified by declaring it and re-measuring: byte-identical. No
      edit made. Written up in the audit doc so it is not re-opened.

- [x] **K. Key fields covered, and the lane verified mergeable.** *(done)*
      The walkthrough now covers the Brave key: set, persist across a reload,
      clear, and the clear persists too. Plus an assertion that a set key never
      appears as plain text in the page, since a key sitting in the DOM leaks
      into screenshots and the screens-tour corpus. Needed a `search-card`
      testid, because OpenRouter is already keyed by the fixture and an
      unscoped "Reveal" matches two buttons. That mismatch looked like a broken
      Brave key at first; it was my selector, confirmed by reading localStorage.
      **Flake check before calling this mergeable:** 3 consecutive unit runs
      (1191 each) and 2 consecutive e2e runs (37 each), all green.
      **Merge state:** `origin/master` has not moved, so the lane is 18 ahead
      and 0 behind. Merging is a fast-forward with no conflicts.

- [x] **L. Wrote down why three defects shipped past a green suite.** *(done)*
      All three had the same shape: a check existed, passed, and could not have
      failed. `CONTRIBUTING.md` gains a "Green is not the same as covered"
      section covering the four variants seen today: an unverified regression
      test, a generic fallback satisfying an "everything is covered" assertion,
      a spec whose Playwright project never ran it, and a prop added but never
      wired. Compounding work, not code.

- [x] **J. Cover `chatPersistenceCoordinator`.** *(done)* It was the largest
      untested file in `src/stores` and the one that decides whether
      conversations reach disk. Twelve tests: pause/resume, the serialized
      workspace save queue (no overlapping saves; intermediates coalesce to the
      newest; a rejected save clears the in-flight flag instead of ending
      workspace persistence for the session), and `trackSnapshotDeep`, whose
      failure mode is silent — no exception, the autosave just stops and a
      conversation is lost on reload. Both key assertions were mutation-checked
      red before being trusted. `modelPickerSelectors` is still uncovered.

## Blocked on Ethan

- Settings restructure: needs a grouping picked (by object / by frequency /
  by subsystem as today). Switchable in the harness.
- Whether agent tasks move out of the sidebar at all, once A unblocks it.
- Merge to master.

## Owner action

**Correction, and it is my fault.** The command previously written here,
`sudo sysctl fs.inotify.max_user_watches=524288`, was a generic default I wrote
before measuring this machine. Ethan ran it on 2026-07-26 evening, and the real
ceiling was already **2,097,152**, so it did not raise the limit, it **lowered
it by 4x**. Do not run that number here.

State right now:

| | value |
|---|---|
| live ceiling | 524,288 (from the `sysctl -w`) |
| watches actually held | 2,097,135 |
| `openai-codex-desktop` pid 980417 | 1,089,832 |
| `cursor` pid 1348783 | 1,004,997 |

Lowering the limit does not revoke watches that already exist, so the two apps
keep theirs and nothing new can be created. Verified: `fs.watch('/tmp')` still
fails with `ENOSPC`.

Two side effects worth knowing:

- The new file `/etc/sysctl.d/40-max-user-watches.conf` (524288) **conflicts
  with the existing `/etc/sysctl.d/60-inotify.conf` (2097152)**. sysctl.d is
  applied in lexical order and later files win, so after a reboot the ceiling
  returns to 2,097,152 and the new file has no effect. Live value and persisted
  intent currently disagree.
- 524,288 is in fact plenty **once the leakers are gone** — a vite dev server
  needs a few thousand watches. The ceiling was never the real problem.

**The fix is still to restart the two apps**, not to change the number:

```sh
# check who is holding watches first
for p in /proc/[0-9]*; do pid=${p#/proc/}; \
  w=$(grep -c '^inotify wd:' $p/fdinfo/* 2>/dev/null | awk -F: '{s+=$2} END{print s+0}'); \
  [ "${w:-0}" -gt 10000 ] && echo "$w  pid=$pid  $(tr -d '\0' < $p/comm)"; done | sort -rn
```

Then quit and reopen Codex Desktop and Cursor from their own UIs. Success
signal: the loop above prints nothing large, and `npm run test:e2e` starts its
own server without `GATESAI_WATCH_POLL=1`.

Optional tidy-up, since the two files now contradict each other:

```sh
sudo rm /etc/sysctl.d/40-max-user-watches.conf   # 60-inotify.conf already sets 2097152
sudo sysctl --system                              # reapply, restoring the live value
```

Agents have no sudo here, so both need your hands. Interim remains
`GATESAI_WATCH_POLL=1`, which both GatesAI repos honour.

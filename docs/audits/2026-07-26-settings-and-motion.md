# Settings and motion audit — 2026-07-26

Source audit for the v2 UI taste pass (`ui/taste-pass-20260726`). Partially
satisfies QA-1's acceptance (a) "a coverage report of which settings work / are
dead / are confusing" and (b) "a proposal to slim settings we don't need". The
Playwright walkthrough half of QA-1 is still open.

Read against the code, not the docs, on 2026-07-26.

## Motion: the finding that mattered

`editorial.css` defined `--motion-fast: 140ms ease` and
`--motion-fade: 160ms ease`, with the easing baked into the duration token. Any
call site writing `animation: fadeIn var(--motion-fade) ease` therefore expanded
to `160ms ease ease`, which is invalid, and a CSS variable that is invalid at
computed-value time falls back to *initial*, not to the cascade. So
`animation-name` resolved to `none`.

**Four entrance animations and the thread-switch view transition were dead in
every shipped build**: the message entrance, the jump-to-bottom pill, the copy
hint and the first-run coachmark, plus `::view-transition-old/new(root)` whose
`animation-duration` longhand was fed a two-part shorthand.

Measured on master before the fix, and in the lane after, by probing a real
`.editorial-message` in both running builds:

| | master | lane |
|---|---|---|
| `animationName` | `none` | `fadeIn` |
| `animationDuration` | `0s` | `0.16s` |

It survived because the only two surfaces that used the token *without* adding
their own easing, the command palette and the menu, are the two a developer
opens most often. Fixed in `efe6bd0`.

Other motion findings, all fixed in the lane:

- The jump-pill halo animated `box-shadow` infinitely, forcing a repaint every
  frame on a control that is visible precisely while the user is reading.
- The undo toast had no enter or exit at all; it appeared and vanished mid-frame.
- The dock had no collapse transition, the largest un-animated layout change in
  the app, because `DockPanel` returned two different elements rather than
  resizing one.
- `Toggle` animated `left` on its knob, a layout property, on the most-toggled
  control in the app.
- Four `@keyframes` were dead code, plus an `animation-play-state` referencing an
  animation that no longer existed.
- The `prefers-reduced-motion` block was thorough but could not reach
  view-transition pseudo-elements, which `*` does not match.

**Retired by measurement, no change made.** The audit suspected that
`.editorial-message`'s `content-visibility: auto` with `contain-intrinsic-size:
0 200px` would make rows jump when they scroll in, since a real row is rarely
200px. Measured against a seeded thread the rows are 111, 169, 111 and 253px,
so the estimate is indeed wrong in both directions. But Chrome computes
`containIntrinsicSize` as `auto 0px auto 200px` **whether or not `auto` is
declared**: the last-remembered-size behaviour is automatic for
`content-visibility: auto` elements, so the 200px only applies before a row has
ever rendered. Declaring `auto` explicitly produced a byte-identical computed
value. Nothing to fix; recorded so this is not re-investigated.

One motion claim in the original audit was **wrong and is corrected here**: it
counted 31 of 49 transitions as hand-written. Most of those live in
`services/chat/libraryExport.ts`, which generates a standalone HTML document
with no access to the app's custom properties. Its durations are correct as
written. The genuine in-app count was six.

## Settings: per-area verdicts

### Works, keep

- **Deep-linking into a tab from the point of failure** (composer banners →
  Models, message → Agent). The strongest thing on the surface.
- **Danger zone showing live counts** and disabling actions when there is
  nothing to delete.
- **"Try recall"**: a settings control that lets you observe the effect of the
  setting. Rare, and worth copying elsewhere.
- **Honest live status rows**: bridge state, chunk counts, catalog freshness,
  Ollama online/model count.
- **Export/import** with an explicit merge-vs-replace choice and a typed
  confirmation on the destructive path.

### Dead — removed in this lane (`ac5471b`)

| Thing | Why it was dead |
|---|---|
| `MenuSectionMeta.supported` + `badge: 'Coming soon'` | All three sections set `supported: true`, so the disabled attribute, the colour/opacity/cursor ternaries, the fallback lookup and the badge could never render. |
| `ProviderCard.needsBaseUrl` and its whole branch | Leftover from the openai-compat provider retired 2026-07-19. The only `ApiProviderCardInfo` sets it `false`. |
| Duplicate section labels | Defined twice, in two files, in two different orders. Now `core/menuSections.ts`. |

### Dead-looking but NOT dead — left alone

The eight unwired `UiPrefsSnapshot` fields look like vestige from the retired
Appearance tab, but `animationsEnabled` drives the animation kill-switch in
`App.tsx`. Removing the block wholesale would break it. Anyone revisiting this
should remove them individually, not as a group.

### Confusing — proposed, not yet done

1. **The three tabs are cut by subsystem, not by object.** "Settings" holds
   theme *and* export *and* the danger zone. "Agent" holds instructions *and*
   facts *and* the library *and* semantic recall, which alone is roughly 40% of
   the whole surface by pixel count and close to the last thing a new user
   needs. Three alternative cuts are switchable in the design harness.
2. **Every binary decision ships in three shapes at once**: toggles for recall,
   radio buttons for import mode, and Include/Exclude text buttons sitting one
   row below actual toggles.
3. **Destructive confirmation also ships in three shapes**: `window.confirm`
   twice in `Agent.tsx`, an inline confirm in `Settings.tsx`, and a typed-phrase
   input for import-replace.
4. **"Saved facts" appears twice on one screen**, as an editable list and again
   as a toggleable recall source, under two different mental models.
5. **The Settings page kicker misdescribes its own contents**: it reads
   "theme · app data · danger zone" and omits Conversations and Desktop.
6. **Semantic recall should be progressively disclosed.** It is ~170 lines of
   JSX with expandable groups rendering up to 60 items each.
7. **Settings state is spread over ~13 localStorage keys**, and one control's
   availability depends on a background job: the semantic-recall master toggle
   is disabled until an index exists, which in turn needs Ollama running and an
   embedding model installed, both configured on a different tab.

Items 1 to 6 are structural and need an owner decision on the grouping before
implementation. Item 7 is documentation, not a defect.

## QA-1 walkthrough: written, and it paid immediately

`tests/e2e/settingsWalkthrough.spec.ts` now drives each persisted control,
changes it, reloads and asserts it survived. This audit was read from source,
and the walkthrough exists precisely because source reading cannot see whether
a control actually works.

It found one on its first run. **The theme switcher had never worked**:
`setTheme` was missing from `UiStore`'s `action.bound` list, so `Settings`
passing `ui.setTheme` straight to `SegmentedControl`'s `onChange` invoked it
with no receiver and it threw `Cannot set properties of undefined (setting
'theme')`. Clicking Dark, Light or System did nothing, silently. Its immediate
neighbours are bound, which is why the toggles either side worked and the hole
was invisible to inspection.

Coverage so far: colour mode, automatic thread titles, close-to-tray, the agent
system prompt, saved facts (including that a delete stays deleted), the Ollama
address, a guard that no settings click throws in the page, and a Web Lite
assertion that the desktop-only switches are absent rather than inert.

Still uncovered: the OpenRouter and Brave key fields (they touch secret
storage), the model catalog actions, and everything under semantic recall,
whose availability depends on a background index.

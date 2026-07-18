# DISPATCH — CB-1 source change (follow-up task spec)

The design in `DESIGN.md` requires a source edit that lies outside this task's
lease (which owns only `docs/plans/.../`). Dispatch the following bounded task
to apply it.

---

## Task spec

- **title:** CB-1 impl: soften composer focus to a background glow (no hard ring)
- **model tier:** smart (small, taste-sensitive CSS change)
- **owns:**
  - `src/styles/editorial.css`
  - `tests/e2e/polish.spec.ts` (optional test tightening only)
- **do NOT touch:** `docs/roadmap.md` (harvesting session ticks it),
  `src/components/editorial/composer/composerStyles.ts`, `:root` focus tokens.

### goal

Implement `DESIGN.md` §4 verbatim (tune alpha/blur numbers against real
screenshots if needed, staying within the "soft glow, no hard ring" intent):

1. In `src/styles/editorial.css`, extend the `.composer-row` `transition` to
   include `box-shadow`.
2. Replace the three `.composer-row:has(.composer-textarea:focus…)` rules
   (~lines 1506-1516) so that:
   - **no rule contains a zero-blur `0 0 0 2px var(--focus-ring)` hard ring;**
   - focus applies a translucent accent **fill** (large-spread inset box-shadow,
     e.g. `inset 0 0 0 200px color-mix(in srgb, var(--accent) 4-6%, transparent)`)
     — needed because the panel fill is set inline in `ROW_STYLE`, so a plain
     `background:` override would be ignored;
   - focus applies a wide, blurred, low-alpha **outer halo**
     (e.g. `0 0 18-22px 2-3px color-mix(in srgb, var(--accent) 8-12%, transparent)`);
   - `:focus-visible` is a touch stronger than plain `:focus` (border + halo)
     to preserve the keyboard-focus affordance ladder (WCAG 2.4.7).
3. Keep the `:not(:placeholder-shown)` keystroke-ack border bump (softened).

### acceptance

- Focused composer shows **no hard accent ring** in the default (dark) theme —
  focus reads as a gentle warming of the field.
- Keyboard focus is **visibly distinct from blur in both light and dark**
  themes (border-color shift toward accent is the load-bearing indicator).
- **Before/after screenshots** (dark + light, keyboard-focused) attached to the
  PR.
- `npm run ci` green; `npm run test:e2e` green. No `cargo test` needed (no Rust).
- `docs/changelog.md` session entry appended; CB-1 roadmap checkbox left for the
  harvesting session (do not edit roadmap in the impl task).

### test-cmd

```sh
npm run ci && npm run test:e2e
```

### notes for the implementer

- The existing e2e guard `tests/e2e/polish.spec.ts:16` still passes as-is
  (asserts composer focus `box-shadow !== 'none'`, which stays true). Optionally
  tighten it to assert the computed `box-shadow` does **not** contain a `2px`
  zero-blur ring — but only if the assertion is robust across engines; a brittle
  string match is worse than none. Leave it alone if unsure.
- Do not weaken `eslint.config.js` or the layer boundaries — this is CSS-only.
- Full rationale, exact CSS, WCAG reasoning, and runtime coverage in
  `DESIGN.md` (same folder).

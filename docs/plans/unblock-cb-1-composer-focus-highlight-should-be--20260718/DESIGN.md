# CB-1: Composer focus highlight → soft background glow (design + execution plan)

**Status:** design complete, ready to dispatch source change.
**Roadmap item:** CB-1 (Local-model UX + composer polish, Ethan 2026-07-12).
**Ethan's decision:** APPROVED.
**Owns (this lease):** `docs/plans/unblock-cb-1-composer-focus-highlight-should-be--20260718/` only.
The actual CSS edit is specified as a follow-up task in `DISPATCH.md` (below).

---

## 1. Problem

Ethan finds the composer's focus ring too loud. Today, focusing the composer
draws a **crisp 2px accent outline plus a 5px glow** on the rounded wrapper:

```css
/* src/styles/editorial.css ~1506-1516 */
.composer-row:has(.composer-textarea:focus) {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  box-shadow: 0 0 0 3px var(--focus-ring-glow);
}
.composer-row:has(.composer-textarea:focus-visible) {
  border-color: color-mix(in srgb, var(--accent) 68%, var(--border));
  box-shadow: 0 0 0 2px var(--focus-ring), 0 0 0 5px var(--focus-ring-glow);   /* the hard ring */
}
.composer-row:has(.composer-textarea:focus:not(:placeholder-shown)) {
  border-color: color-mix(in srgb, var(--accent) 62%, var(--border));
}
```

The textarea's own outline is already suppressed (`.composer-textarea:focus{outline:none}`,
editorial.css ~1468) and focus is intentionally drawn on the rounded
`.composer-row` container — that container choice stays. Only the *appearance*
of the affordance changes: a hard border -> a gentle warming of the field.

## 2. Goal / acceptance (verbatim from roadmap)

- Focused composer has **no hard accent ring** in the default theme.
- Focus reads as a **subtle background glow**: shift the composer fill toward
  `--accent` a few percent and/or a wide, low-alpha inset/blur halo.
- Keep a **real `:focus-visible` affordance for keyboard users (WCAG)** —
  soften, don't delete.
- Keyboard focus still **visibly distinct from blur in both light and dark**.
- Screenshot before/after in the PR; `npm run ci` green.

## 3. Key facts discovered (constraints the implementer must respect)

1. **The composer fill is set inline, not in CSS.** `ROW_STYLE`
   (`src/components/editorial/composer/composerStyles.ts:44`) sets
   `background: 'var(--panel)'` as an inline style on `.composer-row`. Inline
   styles beat class rules, so **a `background:` override in editorial.css will
   NOT take effect.** To shift the fill toward accent *without* editing the TSX,
   use a **large-spread inset `box-shadow`** (a translucent accent wash painted
   over the panel background inside the border-box). This is the recommended
   path: it keeps the change entirely inside `src/styles/editorial.css`, one
   file, no component churn.
   - Alternative (not recommended for v1): move `background` out of `ROW_STYLE`
     into a `.composer-row { background: var(--panel) }` rule so focus rules can
     override it. Cleaner long-term but touches a second file and a shared
     inline-style constant with no functional gain over the inset-wash approach.

2. **`.composer-row` border-radius is 10px** (from `ROW_STYLE`, plus per-runtime
   overrides in `responsive.css`). Inset box-shadows respect `border-radius`, so
   the wash gets rounded corners for free. Outer halo (`0 0 Npx ...`) also
   respects radius. `overflow: visible` is already set — fine for the outer halo.

3. **`.composer-row` transition currently only animates `border-color`**
   (editorial.css ~1482, and `ROW_STYLE` inline). Add `box-shadow` to the
   transition so the warming fades in/out smoothly.

4. **`:focus-visible` on a `<textarea>` matches on *any* focus** (mouse or
   keyboard), because text-entry controls always show a focus-visible
   indicator. So the current `:focus` vs `:focus-visible` split does **not**
   distinguish input method here — both effectively fire on focus. That's fine:
   we keep both rules (focus-visible slightly stronger) so the affordance still
   degrades correctly on browsers without `:focus-visible`, and the "no hard
   ring" requirement is met by removing the `2px var(--focus-ring)` layer from
   **both** rules.

5. **Existing e2e guard:** `tests/e2e/polish.spec.ts:16` ("draws keyboard focus
   around the rounded composer...") asserts on `.composer-row` focus:
   `radius > 8` and `box-shadow !== 'none'`, and on the textarea `outline:none`,
   `box-shadow:none`. **The proposed design keeps a (soft) box-shadow, so this
   test stays green.** The implementer should *optionally* tighten it to also
   assert the shadow no longer contains a hard `2px` ring (see DISPATCH).

## 4. Proposed CSS (the concrete change)

Replace the three `.composer-row:has(...)` focus rules and extend the
`.composer-row` transition in `src/styles/editorial.css`:

```css
.composer-row {
  border: 1px solid var(--border);
  box-sizing: border-box;
  min-width: 0;
  overflow: visible;
  /* add box-shadow so the focus glow fades smoothly */
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

/* CB-1: focus reads as a gentle warming of the field, not a hard ring.
   - a translucent accent wash fills the field (large-spread inset shadow,
     painted over the inline `var(--panel)` background, clipped to the radius)
   - a wide, low-alpha outer halo replaces the crisp 2px outline
   The border-color shift is the primary keyboard-focus affordance (WCAG). */
.composer-row:has(.composer-textarea:focus) {
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
  box-shadow:
    inset 0 0 0 200px color-mix(in srgb, var(--accent) 4%, transparent),
    0 0 18px 2px color-mix(in srgb, var(--accent) 8%, transparent);
}
/* Keyboard/AT users get a slightly stronger — still soft — affordance. */
.composer-row:has(.composer-textarea:focus-visible) {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  box-shadow:
    inset 0 0 0 200px color-mix(in srgb, var(--accent) 6%, transparent),
    0 0 22px 3px color-mix(in srgb, var(--accent) 12%, transparent);
}
/* With content typed, warm the border a touch more (keystroke ack). */
.composer-row:has(.composer-textarea:focus:not(:placeholder-shown)) {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
}
```

Notes on the numbers (tune during implementation against real screenshots):

- The old ring used `--focus-ring` = accent @ 56% and `--focus-ring-glow` =
  accent @ 18%. The new outer halo is accent @ 8-12% and *blurred* (18-22px)
  rather than a 0-blur spread — that is the difference between "ring" and
  "glow." No `0 0 0 2px`/`0 0 0 3px` zero-blur layers remain.
- The inset wash is 4-6% accent — enough to read as a warm tint, low enough to
  keep text contrast intact (text sits above the wash and is unaffected).
- The `focus-visible` state is deliberately stronger than plain `focus`
  (border 42% vs 24%, halo 12% vs 8%) so the affordance ladder is preserved.

## 5. WCAG rationale (why this still passes "soften, don't delete")

- **2.4.7 Focus Visible (AA):** focus produces a clearly perceptible change —
  a border-color shift from `--border` toward accent (24-42%) plus a warm fill
  and halo. Focused != blurred is unambiguous in both themes.
- **Both themes:** accent is `#3ecf8e` on `#181818` panel (dark) and `#0f6b46`
  on `#faf8f3` panel (light) — the border shift toward accent yields a visible
  contrast delta against the adjacent panel in both. Verify on screenshots.
- The requirement is explicitly to *soften, not remove* the affordance; the
  border-color change is the load-bearing indicator, the wash/halo are
  reinforcement. We are not relying on the low-alpha glow alone.
- `prefers-reduced-motion`: only opacity/color transitions are involved; no
  additional guard needed (consistent with the rest of editorial.css).

## 6. Runtime coverage (desktop + Web Lite)

Pure CSS on `.composer-row`, which exists in both runtimes. `responsive.css`
only overrides `min-height`/`border-radius`/`padding` per runtime — none of the
focus box-shadow — so the glow applies identically in desktop and Web Lite. No
`core/runtime.ts` gating needed.

## 7. Verification plan

1. `npm run ci` (vitest + typecheck + lint) — green. CSS-only, no unit-test
   surface changes; the existing `polish.spec.ts` guard still holds.
2. `npm run test:e2e` — the composer-focus e2e test must stay green
   (`box-shadow !== 'none'` still true).
3. **Manual before/after screenshots** (required by acceptance): focused
   composer in **dark** and **light** themes, keyboard-focused, confirming
   (a) no hard accent ring, (b) focus clearly distinct from blur. Attach to PR.
4. No `cargo test` needed (no `src-tauri/` changes).

## 8. Out of scope

- Redesigning the global `--focus-ring` used elsewhere (buttons, inputs) — CB-1
  is scoped to the composer only. Leave `:root` focus tokens untouched.
- Changing where focus is drawn (still the `.composer-row` container).
- Touching `composerStyles.ts` — avoided by the inset-wash approach.

# DISPATCH — implement LF-2 distinct mobile-topbar labels

Follow-up implementation task for the approved LF-2 accessibility bug. The
design and roadmap discrepancy are recorded in [PLAN.md](./PLAN.md).

## Task spec

- **title:** Fix LF-2 duplicate mobile-topbar accessible names
- **goal:** Implement `PLAN.md` exactly:
  1. In `src/components/editorial/EditorialSidebar.tsx`, change only the
     `.editorial-mobile-topbar__more` button's `aria-label` and `title` from
     `Open sidebar` to `More options`. Keep the left hamburger's thread-route
     label `Open sidebar`, its menu-route label `Back to chat`, and all click,
     drawer, icon, and routing behavior unchanged.
  2. Extend `tests/components/editorial/EditorialSidebar.test.ts` with a
     mobile-shell regression test using its existing store/render harness.
     Set `ui.mobileShell = true` in a MobX action and verify the topbar has
     exactly one `button[aria-label="Open sidebar"]`; the ellipsis has
     `aria-label="More options"` and `title="More options"`. Also cover the
     menu-route `Back to chat` state in the same test or a second focused test.
  3. Append a dated `docs/changelog.md` entry describing the accessibility
     fix. Do not touch CSS, dependencies, persistence, bridge/Tauri code, or
     unrelated accessibility copy.
  4. Do not edit `docs/roadmap.md` in this implementation lane. LF-2 is
     currently absent from the LF block; the harvesting session owns adding
     the missing item and recording completion after this source lane is green.
- **owns:**
  - `src/components/editorial/EditorialSidebar.tsx`
  - `tests/components/editorial/EditorialSidebar.test.ts`
  - `docs/changelog.md`
- **test-cmd:** `npx vitest run tests/components/editorial/EditorialSidebar.test.ts && npm run ci && npm run test:e2e`
- **model tier:** fast (two attribute edits plus one focused component test)

## Acceptance criteria

- A mobile thread topbar has one and only one `Open sidebar` accessible name.
- The ellipsis has accessible name and tooltip `More options`.
- The mobile menu's left button remains `Back to chat`.
- Existing drawer-opening behavior, routing, icons, and layout are unchanged.
- The focused component test, `npm run ci`, and `npm run test:e2e` are green.
- Desktop and Web Lite are both covered by the shared mobile-shell component;
  no runtime-specific implementation is introduced.

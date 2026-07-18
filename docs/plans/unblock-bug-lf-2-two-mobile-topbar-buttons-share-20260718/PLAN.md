# LF-2 plan — distinct mobile-topbar accessible names

Date: 2026-07-18

Decision input: **APPROVED**

Implementation handoff: [DISPATCH.md](./DISPATCH.md)

## Outcome

Give the two mobile-topbar controls distinct, truthful accessible names. The
left hamburger remains **Open sidebar**; the right ellipsis becomes **More
options**. The ellipsis tooltip changes with its accessible name. Layout,
icons, click behavior, drawer behavior, and routing do not change.

This is a source change, so this planning-only lane does not close LF-2. The
follow-up source lane in `DISPATCH.md` must pass the repository gates before
the harvesting session records completion.

## Canonical evidence and roadmap disposition

- `docs/audits/local-first-audit.md:74` records LF-2 and the exact candidate
  labels: "Open sidebar" and "More options".
- `src/components/editorial/EditorialSidebar.tsx` currently gives both
  `.editorial-mobile-topbar__button` (hamburger) and
  `.editorial-mobile-topbar__more` (ellipsis) the `aria-label` "Open sidebar".
  The ellipsis also has the tooltip `title="Open sidebar"`.
- `docs/roadmap.md` contains LF-1 and LF-3 through LF-9 in the local-first
  follow-up block, but no LF-2 checkbox. This confirms the task description:
  the audit finding was never promoted even though the completed audit item
  says LF-1 through LF-9 were filed.

The approved Visions item and audit finding are therefore the authoritative
execution inputs; there is no matching markdown checkbox to edit today. This
lane is forbidden from touching the roadmap. After the source dispatch is
green, the harvesting session should add the missing LF-2 entry to the LF
block as completed with a dated note (or update the corresponding graph-linked
roadmap item if one has materialized by then). It must not mark LF-2 complete
from this plan alone.

## Design

The mobile topbar is rendered once and shared by the desktop and Web Lite
runtimes whenever `UiStore.mobileShell` matches the mobile breakpoint. The fix
stays in that shared component:

| Control | Current accessible name | Final accessible name | Behavior |
| --- | --- | --- | --- |
| Left hamburger on a thread | Open sidebar | Open sidebar | Opens the drawer |
| Left back button in a menu | Back to chat | Back to chat | Returns to chat |
| Right ellipsis | Open sidebar | More options | Opens the drawer containing additional actions |

For the ellipsis, `aria-label` and `title` must both be `More options`; keeping
them aligned avoids a screen-reader/tooltip mismatch. No CSS or icon work is
needed. This is not a visual redesign, so the workspace mockup-round rule does
not apply.

## Implementation

1. In `src/components/editorial/EditorialSidebar.tsx`, change only the
   `.editorial-mobile-topbar__more` button's `aria-label` and `title` from
   `Open sidebar` to `More options`.
2. In `tests/components/editorial/EditorialSidebar.test.ts`, add a focused
   mobile-shell regression test. Set `store.ui.mobileShell = true` inside
   `runInAction`, render the existing component harness, and assert:
   - the hamburger has accessible name `Open sidebar`;
   - exactly one topbar button has that name;
   - the ellipsis has accessible name and title `More options`.
3. Run the focused component test, then the full frontend and E2E gates.
4. Add a concise changelog entry. Leave roadmap mutation to harvesting because
   this planning task has no authority outside its plan folder.

## Scope boundaries

In scope:

- The two string attributes on the ellipsis button.
- A component-level regression test covering the mobile shell.
- A changelog note in the implementation lane.

Out of scope:

- Changing either button's click handler or removing one of the controls.
- Creating a new overflow menu, changing the sidebar contents, or altering
  mobile layout/CSS.
- Adding a dependency, persistence/schema changes, bridge/Tauri changes, or
  runtime-specific branches.
- Broad accessibility cleanup outside this named duplicate-label defect.

## Acceptance

- On a mobile thread route, the topbar exposes exactly one button named `Open
  sidebar` and one button named `More options`.
- The ellipsis `title` is also `More options`.
- On a mobile menu route, the left control remains `Back to chat`; the right
  control remains `More options`.
- Button behavior and visuals are unchanged in desktop and Web Lite mobile
  shells.
- The focused Vitest, `npm run ci`, and `npm run test:e2e` pass. No Rust gate
  is needed because no Rust file changes.

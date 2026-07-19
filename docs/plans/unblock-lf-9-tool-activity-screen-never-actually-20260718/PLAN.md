# LF-9 execution plan — capture and audit expanded tool activity

Date: 2026-07-18

Decision input: **APPROVED**

Canonical item: `docs/roadmap.md` → **LF-9: tool-activity screen never actually captured**

Implementation handoff: [DISPATCH.md](./DISPATCH.md)

## Outcome

Make the canonical local-first screenshot tour open the seeded tool activity
row before taking `screen-chat-tool-activity.png`. The capture must visibly
contain the tool's output, must be byte-distinct from
`screen-chat-active.png`, and must be reclassified in the audit from the stale
"unaudited" GAP to the verdict supported by the expanded surface.

This is a capture-harness correction, not an activity-UI redesign. The current
component already exposes the needed disclosure control and correctly renders
the seeded result. The missing interaction is entirely in the tour.

Roadmap disposition for this planning lane: **keep LF-9 open until the source
dispatch regenerates and audits the evidence; then the harvesting session may
mark it complete.**

## Current evidence and root cause

- `scripts/screens-local-first-audit.spec.mjs` captures the populated chat,
  reloads the same seed, waits only for the collapsed summary text
  `Inspected workspace files`, and immediately captures the tool-activity
  image. It never clicks a disclosure.
- The current legacy files prove the failure:
  - `screen-chat-active.png` SHA-256:
    `2af16ac6cf711c89f6040760d17179f52d7bbd9f11077facca9680a8bcf70a71`
  - `screen-chat-tool-activity.png` SHA-256:
    `2af16ac6cf711c89f6040760d17179f52d7bbd9f11077facca9680a8bcf70a71`
- The fixture contains one completed `fs` list call at `/workspace`, with the
  summary `Inspected workspace files` and output:
  `src/`, `scripts/`, `docs/`, and `package.json`.
- `ActivityRow` renders that completed call as an expandable button whose
  accessible name is `Reading workspace`; on click it changes
  `aria-expanded` from `false` to `true` and renders `.activity-row__detail`.
- `detailForToolResult` classifies non-terminal `fs` output as markdown, so the
  expected expanded proof is visible text inside the assistant activity row.
- `docs/audits/local-first-audit.md` explicitly records LF-9 as corpus
  fidelity, not a product behavior or security defect.

The separate `docs/screens/desktop-mocked/03-chat-tool-activity.png` is already
byte-distinct from its active-chat neighbor, but it also shows only a collapsed
terminal row. It is not the canonical LF-9 evidence and does not resolve this
item.

## Required source change

In the LF-9 block of `scripts/screens-local-first-audit.spec.mjs`:

1. Open the seeded `audit` thread as today.
2. Locate the exact activity disclosure with
   `getByRole('button', { name: 'Reading workspace', exact: true })`.
3. Assert it starts collapsed (`aria-expanded="false"`).
4. Click it.
5. Assert `aria-expanded="true"` and assert the corresponding
   `.activity-row__detail` is visible with at least two exact fixture markers,
   such as `src/` and `package.json`.
6. Only then call `capture(page, 'screen-chat-tool-activity.png')`.

The assertions are the regression test. Merely clicking and waiting for a
timeout is insufficient: a selector drift, disabled row, or failed disclosure
must fail the tour instead of silently recreating the bad evidence.

Prefer scoping the detail assertion to the same `.activity-row` as the button
so a future second tool call cannot satisfy it accidentally. Do not add a
production-only selector; the accessible button state and existing classes are
already sufficient.

## Evidence regeneration without unrelated corpus churn

The audit spec always captures all 22 manifest entries, and its default output
is the tracked `docs/audits/screens-2026-07/` directory. The rest of that
corpus predates several independent fixes; regenerating and committing all 22
images would silently expand LF-9 into a full re-audit.

For this item:

1. Run the underlying Playwright spec with `SCREENS_AUDIT_DIR` set to a fresh
   directory under `/home/ethan/.cache/tmp/`.
2. Confirm the staged active/tool PNGs are byte-distinct with `cmp` or
   SHA-256.
3. Visually inspect the staged tool image and confirm the directory-list output
   is actually visible and legible.
4. Promote only `screen-chat-tool-activity.png` to
   `docs/audits/screens-2026-07/` as the durable LF-9 evidence.
5. Do not commit incidental regenerated screenshots for unrelated surfaces.

This preserves the current audit scope while still exercising the exact spec
that `npm run screens:tour` invokes. Temporary output is deliberately placed
under the machine's cache, never `/tmp`; it can be left for the cache janitor.

## Re-audit verdict

Expected verdict: **GOOD**, provided the regenerated image matches the seeded
state described above.

Reasoning to record after visual verification:

- Expanding the row discloses only the local tool result (`src/`, `scripts/`,
  `docs/`, `package.json`).
- The surface does not request a cloud key, account, remote service, or silent
  fallback.
- The activity summary and detail remain attached to the assistant reply, and
  disclosure is user-controlled, which matches the product's quiet-power
  principle: tool noise stays collapsed until wanted.
- The tool itself depends on the local desktop workspace bridge, but that is a
  local capability rather than a cloud dependency and is represented honestly
  by the local workspace path.

If the actual regenerated image contradicts any of those facts, do not force
the GOOD verdict. Record the concrete visible gap and file a separate roadmap
item; LF-9 still closes once the surface is truthfully captured and audited.

Update both LF-9 references in `docs/audits/local-first-audit.md`:

- In the audit matrix, replace the stale byte-identical GAP with the verified
  verdict and describe the visible expanded output.
- In the findings section, mark LF-9 resolved with the new SHA-256 values (or
  remove it from the unresolved findings and add a dated resolution note).

Append a dated `docs/changelog.md` entry. The source implementation lane must
not edit `docs/roadmap.md`; the harvesting session owns the canonical checkbox
transition.

## Non-goals

- No changes to `ActivityRow`, activity projection, tool metadata, stores,
  persistence, or CSS.
- No redesign of collapsed/expanded tool activity.
- No changes to the modern `tests/e2e/screensTour.spec.ts` or
  `docs/screens/**`; those form a separate general screenshot corpus.
- No full local-first re-audit of the other 21 legacy screenshots.
- No bridge, Rust, schema, dependency, or Web Lite change.

## Verification

The follow-up lane must run:

1. `npm run ci` for the repository's unit/type/lint gate.
2. The exact local-first audit Playwright spec with a fresh cache output
   directory.
3. A byte comparison proving the staged active and expanded-tool images differ.
4. `npm run test:e2e` to show the harness change does not regress normal
   desktop/Web Lite flows.
5. A visual inspection of the new canonical PNG.

The Playwright commands need the orchestrator's outside-sandbox verifier
because this Codex sandbox cannot bind the Vite listeners. Do not weaken or
skip browser verification inside a sandbox.

## Acceptance criteria

- The tour semantically proves the `Reading workspace` disclosure is expanded
  before capture (`aria-expanded=true`, detail visible, fixture output visible).
- The new canonical `screen-chat-tool-activity.png` visibly contains the
  expanded `src/` / `scripts/` / `docs/` / `package.json` result.
- The canonical active and tool-activity PNGs have different SHA-256 hashes.
- The audit matrix no longer says the surface is unaudited and records the
  visually verified verdict.
- The LF-9 finding has a dated resolution note and new evidence hashes.
- `npm run ci`, the cache-directed capture run, the byte comparison, and
  `npm run test:e2e` pass.
- Only the source spec, LF-9 screenshot, audit text, and changelog are changed;
  no unrelated screenshot churn or production behavior change is present.

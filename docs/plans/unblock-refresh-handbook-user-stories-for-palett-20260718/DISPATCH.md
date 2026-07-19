# Follow-up source dispatch

## Task

**Title:** Refresh handbook user stories for palette, onboarding, MCP, and usage

**Goal:**
Refresh `docs/handbook/user-stories.md` per
`docs/plans/unblock-refresh-handbook-user-stories-for-palett-20260718/design.md`.
Replace the stale P0/P1/P2 table with four clearly marked delivered product
stories for the command palette, first-run local-first onboarding, MCP server
lifecycle, and recorded usage. Retire the fourteen superseded generic rows in
a compact dated audit note, retain the reusable future-story template verbatim,
and make no behavior or roadmap change.

## Owns

Claim this literal repo-relative path before editing:

```text
docs/handbook/user-stories.md
```

Do not edit `docs/roadmap.md`, `docs/changelog.md`, any other handbook page,
source code, tests, or the planning deliverable directory. The harvesting
session owns the roadmap transition; this task is not a product release.

## Required implementation

1. Preserve the `# User Stories` heading and opening purpose, but remove the
   current priority table and all `P0`/`P1`/`P2` labels.
2. Add a short “Delivered product stories” introduction that makes clear these
   are verified behavior contracts, not open roadmap items.
3. Add exactly four headings, each with the standard user-story statement and
   observable acceptance bullets:
   - command palette: Ctrl/Cmd+K, visible-thread/action search, keyboard
     selection/close behavior, and bridge-gated dock/workspace entries;
   - first-run onboarding: detected local-first desktop path, explicit cloud
     and explore-later paths, readiness/error/dismissal persistence, and Web
     Lite’s local-runtime boundary/no fallback;
   - MCP: HTTP versus desktop stdio distinction, testable status/tool count,
     secret-safe configuration, explicit local-command trust warning, and no
     dynamic tools while disabled, disconnected, or failed;
   - Usage: persisted completed-response source, empty state, cloud/local and
     provider/fallback distinction, all-time/30-day/per-model/per-day views,
     and no invented spend when usage is absent.
4. Add the compact “Retired story set” note dated 2026-07-18. Name the
   superseded rows sufficiently for an auditor to identify them, but do not
   copy their old acceptance criteria or recreate a backlog.
5. Leave the existing “Story format for future additions” section and its code
   block unchanged. Link to `capabilities.md` or `user-journeys.md` only when
   it prevents duplication; do not edit either file.

## Constraints

- The code and focused tests named in the design are the truth source. Do not
  claim an MCP transport, Web Lite capability, local fallback, cost value, or
  onboarding UI path the implementation does not support.
- Use user-observable language. Avoid source paths, test counts, provider
  marketing, generic “plugin” claims, and vague “works everywhere” language.
- This is docs-only: no dependency, persistence-schema, source, or test change
  is authorized. Do not add a changelog entry.

## Acceptance

- The handbook has exactly four delivered stories covering the named surfaces.
- Each has a happy path plus relevant unavailable/runtime, persistence, or
  safety condition.
- The old broad table is gone and its fourteen rows are traceably retired.
- The reusable story template is unchanged.
- Every assertion agrees with `docs/handbook/capabilities.md` and the code
  evidence cited in the design; no claim implies a silent cloud fallback,
  browser stdio MCP, or fabricated spending data.
- No file outside `docs/handbook/user-stories.md` changes.

## test-cmd

```sh
git diff --check
```

No automated Markdown linter is configured for this repository. In addition to
the command, perform the manual content checks in the design’s Verification
section and report them explicitly.

**Model tier:** fast (single Markdown document; evidence-led editorial pass).

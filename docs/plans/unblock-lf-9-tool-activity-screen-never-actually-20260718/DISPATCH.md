# Follow-up source dispatch — LF-9 expanded tool-activity evidence

Source and evidence changes are required; this lane's lease covers only this
plan folder. Dispatch the task below after reading [PLAN.md](./PLAN.md).

## Task spec

- **title:** LF-9 — expand tool activity before screenshot capture and re-audit it
- **model tier:** smart
- **goal:** |
    Resolve the approved LF-9 roadmap item exactly as specified in
    `docs/plans/unblock-lf-9-tool-activity-screen-never-actually-20260718/PLAN.md`.

    In `scripts/screens-local-first-audit.spec.mjs`, repair the canonical
    `screen-chat-tool-activity.png` step: locate the exact accessible
    `Reading workspace` activity button, assert it starts with
    `aria-expanded=false`, click it, assert `aria-expanded=true`, and assert
    the detail within that same activity row is visible and contains the
    seeded `src/` and `package.json` output before taking the screenshot.
    These semantic assertions are the regression test; do not replace them
    with a timeout or image-difference check alone.

    Regenerate the 22-image spec into a fresh
    `/home/ethan/.cache/tmp/gatesai-lf9.*` staging directory by setting
    `SCREENS_AUDIT_DIR`; verify the staged active and tool PNGs are
    byte-distinct; visually inspect the expanded image; promote only
    `screen-chat-tool-activity.png` into the tracked legacy audit corpus.
    Do not commit regenerated images for unrelated surfaces.

    Re-audit that one surface in `docs/audits/local-first-audit.md`. If the
    staged image matches the current fixture and source contract, change its
    verdict from unaudited GAP to GOOD: the disclosure shows only local
    workspace output and no key/account/cloud dependency, while keeping tool
    noise collapsed until requested. Update the LF-9 findings entry with a
    dated resolution note and the new active/tool SHA-256 hashes. If visual
    evidence contradicts that expected verdict, record the concrete truth
    instead and file a separate roadmap gap through the harvesting session.

    Append a dated `docs/changelog.md` entry. Do not edit
    `docs/roadmap.md`; the harvesting session will tick LF-9 after verified
    integration.

    Do not modify production activity UI, stores, services, CSS, tool
    metadata, the modern `tests/e2e/screensTour.spec.ts` corpus, bridge/Rust
    code, dependencies, persistence, or unrelated audit screenshots.
- **owns:**
    - `scripts/screens-local-first-audit.spec.mjs`
    - `docs/audits/screens-2026-07/screen-chat-tool-activity.png`
    - `docs/audits/local-first-audit.md`
    - `docs/changelog.md`
- **test-cmd:** `npm run ci && capture_dir="$(mktemp -d /home/ethan/.cache/tmp/gatesai-lf9.XXXXXX)" && SCREENS_AUDIT_DIR="$capture_dir" npx playwright test scripts/screens-local-first-audit.spec.mjs --config scripts/screens-audit.playwright.config.mjs && ! cmp -s "$capture_dir/screen-chat-active.png" "$capture_dir/screen-chat-tool-activity.png" && npm run test:e2e`

## Acceptance

- The screenshot step cannot pass unless the intended row is expanded and its
  exact seeded output is visible.
- The durable tool-activity screenshot visibly includes expanded local
  workspace output and hashes differently from the active-chat screenshot.
- The audit's matrix and LF-9 finding truthfully reflect the new visual
  evidence, with SHA-256 hashes recorded.
- No other audit PNG changes and no production behavior changes are present.
- The exact test command passes in the outside-sandbox verifier; the new PNG
  is visually inspected, not accepted from hashes alone.

## Dispatcher notes

- No Ethan gate remains: the decision is already **APPROVED**.
- No sibling-repo task, dependency decision, migration, security review, or
  deploy is required.
- The Playwright portions need an outside-sandbox verifier because the Codex
  sandbox cannot bind Vite ports.
- The `mktemp` output is intentionally under the disk-backed cache and should
  be left for the cache janitor; do not use `/tmp`.

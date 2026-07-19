# Handbook user-story refresh — palette, onboarding, MCP, and usage

*2026-07-18, orchestrator lane
`unblock-refresh-handbook-user-stories-for-palett-20260718`.*
*Roadmap item: “Refresh handbook user stories for palette/onboarding/MCP/usage;
retire delivered ones.” Ethan’s decision: APPROVED.*

## Outcome

Make `docs/handbook/user-stories.md` a useful, truthful product record again.
It currently contains a priority-ranked backlog of fourteen broad stories. Most
of those stories describe behavior that has shipped, while four substantial
current product surfaces—command palette, local-first onboarding, MCP, and
usage—have no dedicated story at all. The document therefore neither tells a
reader what is actually available nor identifies a coherent outstanding body
of work.

The follow-up is documentation-only. It replaces the stale priority table
with four explicitly **delivered** product stories and a short retirement note
for the superseded rows. It must not manufacture an implementation backlog,
change user-facing behavior, alter the roadmap, or imply that a capability is
available in a runtime where it is gated.

## Evidence and source of truth

The handbook must follow code and focused regression coverage—not its old
stories—as the source of truth:

| Surface | Source evidence | Truth the refreshed story must preserve |
| --- | --- | --- |
| Command palette | `src/app/useKeyboardShortcuts.ts`, `src/components/palette/CommandPalette.tsx`, `tests/components/palette/CommandPalette.test.ts` | `Ctrl/Cmd+K` opens a keyboard-operable palette that searches visible threads and registered actions; it closes before running an action. Desktop-only dock/workspace entries are gated rather than shown in Web Lite. |
| First-run onboarding | `src/components/editorial/EditorialChat.tsx`, `src/stores/UiStore.ts`, `tests/e2e/desktop.spec.ts`, `tests/e2e/web-lite.spec.ts` | First-run setup puts a usable local path before cloud on desktop when available, permits an explicit cloud-key path or exploration/dismissal, persists dismissal, and never offers local-runtime controls in Web Lite. Sending stays unavailable until a ready route exists. |
| MCP | `src/stores/McpStore.ts`, `src/components/menu/sections/McpSettings.tsx`, `src/services/mcp/`, `tests/stores/McpStore.test.ts`, `tests/services/mcp/*.test.ts` | User-configured HTTP and desktop stdio servers expose dynamic tools only after a successful connection. Disabled/error/disconnected servers contribute no tools; secrets are kept out of ordinary persistence; local commands require an explicit trust warning. |
| Usage | `src/core/usage.ts`, `src/core/threadSelectors.ts`, `src/components/menu/sections/Usage.tsx`, `tests/core/usage.test.ts`, `tests/core/threadSelectors.test.ts`, `tests/components/menu/GatesMenu.test.ts` | The Usage section derives cloud cost and local token totals from persisted completed-response usage, with all-time, 30-day, per-model, and per-day views. Local work is labelled local/free, provider cost is preferred over catalogue fallback, and missing provider usage must not be presented as a made-up charge. |

`docs/handbook/capabilities.md` remains the concise capability-and-gating
reference. The stories may link to it but must not duplicate its entire tool
inventory. `docs/handbook/user-journeys.md` remains the narrative path; the
stories supply observable acceptance, unavailable-state, persistence, and
safety commitments.

## Documentation shape

Keep the existing title and the one-sentence purpose, then replace the old
priority table with these sections.

### 1. “Delivered product stories”

Start with a one-sentence legend: these are verified behavior contracts, not
open roadmap work. Use one heading per story rather than a wide priority table
so acceptance is readable and testable.

1. **Find and act without hunting through the interface.** As a returning
   user, I want to summon the command palette, find a thread or action with a
   keyboard, and execute it so routine navigation stays out of my way.
   Acceptance covers Ctrl/Cmd+K, filtering visible (not deleted) threads and
   actions, arrows/Enter/Escape, closure after action, and desktop-only
   workspace/dock actions being absent where the bridge is unavailable.
2. **Start locally when possible, with an honest alternative.** As a first-run
   desktop user, I want setup to lead with detected Ollama models while still
   giving me an explicit cloud or explore-later route, so I can start without
   an account or a silent cloud fallback. Acceptance covers ready/local,
   unavailable/error, cloud-key, dismiss/persist, and Web Lite’s cloud-only
   boundary.
3. **Connect a tool server knowingly.** As a power user, I want to add, test,
   enable, disable, and understand an MCP server so external tools enter a
   chat only when the connection is safe and live. Acceptance distinguishes
   streamable HTTP from desktop local-command stdio; includes status/tool
   count, secrets handling, trust warning, dynamic tool withdrawal, and
   connection failures that leave no callable tools.
4. **See the usage that the app actually recorded.** As a cost-conscious user,
   I want cloud spend and local token activity summarized by model and day so
   I can understand completed work without treating estimates or missing data
   as invoices. Acceptance covers the empty state, persisted-completed-message
   derivation, cloud/local distinction, provider-vs-pricing precedence,
   all-time/30-day/model/day breakdowns, and no invented cost.

Use the project’s standard story form under every heading:

```text
As a [type of user],
I want [capability],
so that [user value].

Acceptance:
- Observable happy-path behavior.
- Important unavailable/error or runtime boundary.
- Persistence, privacy, or safety expectation where relevant.
```

The acceptance bullets must be prose contracts, not file names, internal
classes, test counts, or marketing promises. Exact keyboard notation is
allowed. Say “MCP server” rather than claiming a generic plugin system, and
say “recorded usage” rather than “billing.”

### 2. “Retired story set”

After the four records, add a compact note that the former P0/P1/P2 rows were
retired on 2026-07-18 because they described delivered behavior or a vague
future direction rather than open work. List their short labels in one
semicolon-separated sentence for auditability; do not reproduce their stale
acceptance criteria, priorities, or create a second backlog. This includes the
former Web Lite, attachment uniqueness, image-card, rate-limit, artifact,
availability, model-picker, Ollama, image, workspace, tool-detail,
persistence, future-plugin, and self-improvement rows.

End with the existing reusable “Story format for future additions” section,
with its text unchanged. New open work belongs in `docs/roadmap.md`, not this
handbook page.

## Boundaries and non-goals

- Do not edit `docs/roadmap.md`; the harvesting session owns its checkbox.
- Do not change `docs/handbook/capabilities.md`, `user-journeys.md`, source,
  tests, persistence, or product copy in this task. If a contradiction is
  found, report it rather than casually widening handbook scope.
- Do not call HTTP MCP “desktop-only”: HTTP is a separate runtime path. Do say
  that local-command/stdio MCP requires desktop, and do not promise remote
  plain-HTTP connectivity.
- Do not promote provider cost estimates to billing facts, or say that local
  tokens have a dollar price.
- Do not retain `P0`/`P1`/`P2` labels for already-delivered work; that is the
  drift this refresh removes.

## Verification

This is a Markdown-only change, so there is no behavior change requiring a
full application suite. The follow-up must:

1. inspect the diff and run `git diff --check`;
2. re-read every statement against the evidence table above and
   `docs/handbook/capabilities.md`;
3. confirm the document still has one `# User Stories` heading, exactly four
   delivered-story headings, a retirement note, and the unchanged future-story
   template; and
4. report that no automated Markdown linter exists instead of claiming a
   source test suite verified prose.

## Follow-up

The exact docs-only task, ownership, and verification command are in
[`DISPATCH.md`](./DISPATCH.md). It deliberately owns only
`docs/handbook/user-stories.md`; the lane that executes it may update the
roadmap separately only if its dispatch contract grants that path.

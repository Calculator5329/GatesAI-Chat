# DISPATCH — implement SP-1 user-configurable system prompt

This task is immediately dispatchable. Read `PLAN.md` in this folder first;
it is the authoritative design and records the approved decision. The existing
global Agent instructions field is retained; this task fills the per-thread,
micro-mode, migration, wire-proof, and documentation gaps.

## Task spec

- **title:** SP-1 — per-thread system-prompt override with Ollama/Web Lite parity
- **model tier:** smart
- **goal:** |
    Implement
    `docs/plans/unblock-sp-1-user-configurable-system-prompt-tod-20260718/PLAN.md`
    exactly.

    Add `Thread.systemPromptOverride?: string` with three states:
    undefined inherits `UserProfileStore.defaultSystemPrompt`, a non-empty
    string replaces only that user-authored global section, and `''`
    explicitly suppresses custom user instructions while preserving GatesAI's
    built-in contracts. New threads omit it; branches copy it; read-only and
    background-agent task threads cannot misleadingly edit it.

    Bump the chat snapshot schema 3→4 with an ordered additive migration.
    Parse, hot-save, deep-track, archive-stub, export, replace-import, and
    merge-import the field while preserving explicit empty strings. Keep the
    existing global prompt and `gatesai.profile.v1` key unchanged and add a
    direct global-slot round-trip regression.

    Compose the effective user text exactly once. Full and system-tools modes
    retain the normal Desktop/Web Lite/headless harness and existing
    runtime/memory/context/addendum sections. Micro retains its existing
    minimal local/tool contract and appends the effective user text without
    pulling in the full prompt. Bare remains no-system/no-tools. Update both
    `TurnRunner.buildTurnRequest` and `ChatStore.tokenUsageBase` so estimates
    match wire requests. Do not change provider adapters unless direct request-
    body tests expose a defect.

    On Agent → Instructions, clarify the existing global textarea as Default
    instructions and add a Current conversation opt-in plus textarea and Use
    global default action. Empty enabled text is a valid explicit override.
    The same UI works in Desktop and Web Lite; no active/read-only/agent-task
    threads show truthful non-editable copy. Do not add a route, modal,
    composer control, prompt presets, or dependency.

    Add the complete PLAN.md test matrix, including captured Ollama and
    OpenAI-compatible request-body assertions. Update architecture, tech spec,
    user guide, and changelog. Do not edit `docs/roadmap.md`; the harvesting
    session performs the verified checkbox transition.
- **owns:**
    - src/core/types.ts
    - src/core/threadOps.ts
    - src/services/chat/contextModes.ts
    - src/services/chat/turnRunner.ts
    - src/services/chat/dataExport.ts
    - src/services/persistence/migrations.ts
    - src/services/persistence.ts
    - src/stores/UserProfileStore.ts
    - src/stores/ChatStore.ts
    - src/stores/chatPersistenceCoordinator.ts
    - src/components/menu/sections/Agent.tsx
    - tests/core/threadOps.test.ts
    - tests/services/persistence.test.ts
    - tests/services/profileStorage.test.ts
    - tests/services/chat/dataExport.test.ts
    - tests/services/llm/ollama.test.ts
    - tests/services/openrouter.test.ts
    - tests/stores/UserProfileStore.test.ts
    - tests/stores/ChatStore.test.ts
    - tests/components/menu/AgentSection.test.tsx
    - tests/e2e/desktop.spec.ts
    - tests/e2e/web-lite.spec.ts
    - docs/architecture.md
    - docs/tech_spec.md
    - docs/user-guide.html
    - docs/changelog.md
- **test-cmd:** `npm run ci && npm run test:e2e`

## Acceptance details

- Direct Ollama capture proves the custom text and micro built-in contract are
  in the leading system message.
- Direct OpenAI-compatible capture proves the custom text and full built-in
  harness are in the leading system message.
- Assertions prove an override removes the global text but not built-in text;
  explicit empty removes both custom sources but not built-ins.
- v3→v4, hot/archive persistence, export/import, branch, token-meter, Desktop,
  and Web Lite cases are covered.
- `bare`, direct-image, and agent-task prompt behavior remain unchanged.
- No dependency, Rust, Tauri, bridge, sibling-repo, secret, or deployment
  change is present.

## Dispatcher notes

- No Ethan gate remains; `APPROVED` is authoritative.
- This is intentionally separate from the Later roadmap item for named prompt
  presets. Do not fold Coding/Writing/Research presets into SP-1.
- Playwright may need the orchestrator's outside-sandbox verifier because the
  Codex sandbox cannot bind the Vite listener. Do not weaken the command.

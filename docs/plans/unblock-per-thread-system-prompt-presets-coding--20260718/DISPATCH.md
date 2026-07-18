# DISPATCH — implement Coding/Writing/Research per-thread system-prompt presets

This is execution-ready. Read `PLAN.md` in this folder first; it is the authoritative
design and decision context.

## Task spec

- **title:** SP-2 — per-thread system-prompt presets (Coding / Writing / Research)
- **model tier:** smart
- **goal:** |
    Implement `docs/plans/unblock-per-thread-system-prompt-presets-coding--20260718/PLAN.md`
    exactly.

    Add thread-scoped preset storage and behavior using one authoritative field:
    `Thread.systemPromptPreset?: 'coding' | 'writing' | 'research'`.

    Resolution must be:
    manual thread override (if present, preserving SP-1 semantics) >
    preset text mapped from `systemPromptPreset` >
    existing global default instructions.

    Compose and meter system prompts so the selected preset text appears exactly once
    in non-bare modes when active, and never mutates built-in GatesAI contracts.

    Persist the new field through hot snapshot, archive snapshot, deep tracking,
    profile export, replace-import, and merge-import boundaries with deterministic
    validation/migration behavior.

    Add Agent UI controls to select `Default (follow global)`, `Coding`, `Writing`,
    and `Research` for the active editable thread in Desktop and Web Lite, including
    non-editable explanatory state for read-only thread types.

    Add/refresh unit + e2e coverage, including captured Ollama and
    OpenAI-compatible request-body assertions for preset resolution and existing
    bare-mode behavior.
- **owns:**
    - src/core/types.ts
    - src/core/threadOps.ts
    - src/services/chat/contextModes.ts
    - src/services/persistence/migrations.ts
    - src/services/persistence.ts
    - src/services/chat/dataExport.ts
    - src/stores/UserProfileStore.ts
    - src/stores/ChatStore.ts
    - src/stores/chatPersistenceCoordinator.ts
    - src/components/menu/sections/Agent.tsx
    - tests/core/threadOps.test.ts
    - tests/services/persistence.test.ts
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

- `Thread.systemPromptPreset` persists, imports, merges, and migrates correctly.
- Presets appear in full/system-tools/micro leading system prompt content as the
  resolved user instruction text, once each.
- Bare mode prompt behavior remains unchanged.
- Ollama and OpenAI-compatible capture tests prove preset text is present in the
  leading system prompt.
- New/branch/delete/readonly thread scenarios reflect expected preset inheritance or
  editability.
- No prompt-contract, bridge, dependency, or deployment boundary is changed.

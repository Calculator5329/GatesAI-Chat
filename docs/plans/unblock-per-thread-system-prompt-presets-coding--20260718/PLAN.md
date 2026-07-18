# Per-thread system-prompt presets (Coding / Writing / Research)

**Status:** approved and execution-ready  
**Decision input:** `APPROVED`  
**Roadmap source:** `docs/roadmap.md` → `Per-thread system-prompt presets (Coding / Writing / Research)`  

## Outcome

Each thread gets an explicit system-prompt preset slot (`coding`, `writing`,
`research`), with `none` (inherit) as the default. Presets are applied as the
thread’s user-instruction content while keeping existing GatesAI built-in
tool/runtime/context contracts in all non-bare modes.

The feature is implemented as a narrow extension to the already-existing
per-thread customization flow (SP-1 thread instructions): presets are a
structured selector over deterministic, repository-owned prompt snippets and are
stored on the thread for persistence, snapshotting, export/import, and replay.

## Baseline and compatibility assumptions

- There is one global/default instruction setting in profile storage.
- SP-1 thread override behavior (if present in the active branch) remains the
  source of truth for user-authored instruction text.
- This lane must not remove, rename, or fork those existing prompt-storage
  contracts.
- Bare context mode must remain unchanged: it does not send per-thread or global
  user instruction content.

## Scope

### In

- Add a thread-scoped preset field and persist it like any other behavioral thread
  setting.
- Expose a **Thread preset** control in Agent settings with:
  - `Default (follow global)`
  - `Coding`
  - `Writing`
  - `Research`
- Add deterministic prompt snippets for the three presets and wire them into the
  effective user-instruction resolution used by request construction.
- Ensure preset state is copied where behaviorally expected (for example, in branched
  threads) and omitted where not persisted.
- Add migration + parse/export/import coverage so snapshots and exports are
  replayable.
- Update docs and changelog for user-facing behavior.

### Out

- Introducing a free-form custom-instructions editor in this lane.
- Changing context-mode meanings, adding a new non-bare mode, or editing provider
  adapters without proof of regression.
- Web service, network, Rust, bridge protocol, dependency, CI, or deployment
  changes.

## Data and behavior contract

### Thread model

Add to `Thread`:

```ts
type ThreadSystemPromptPreset = 'coding' | 'writing' | 'research';
systemPromptPreset?: ThreadSystemPromptPreset;
```

Semantics:

- `undefined` (default / explicit clear): no preset; thread uses existing default
  inheritance chain.
- `'coding' | 'writing' | 'research'`: apply preset text for this thread.

### Resolution rules

Effective thread user instruction text is resolved as:

1. SP-1 manual per-thread override (if present and non-undefined; empty string is
   the explicit manual suppress mode if branch behavior already defines it).
2. Preset text from `systemPromptPreset`.
3. Existing global default instructions fallback.

That selected user text must be injected exactly once per composed system prompt,
at the same sectioning point used by thread overrides today.

### Preset contents

Presets are canonical constants in the system-prompt composition layer:

- `coding`: implementation-oriented guidance, design-quality checks, and practical
  code-quality conventions.
- `writing`: writing-centric guidance, audience/voice discipline, and narrative
  clarity.
- `research`: analytical framing, source-anchoring behavior, and uncertainty
  signaling.

## UI behavior (Agent settings)

1. Add **Thread preset** control near instruction-related settings.
2. `Default (follow global)` is selected by default and for threads without a preset.
3. Changing a selection writes the thread preset immediately via a new
   `ChatStore.setThreadSystemPromptPreset(threadId, preset)` action (and clear
   action for explicit global inheritance).
4. The active preset is visible and editable in Desktop and Web Lite.
5. For read-only thread contexts (tour/read-only/agent-task per existing patterns),
   show a non-editable helper explanation instead of active mutation controls.
6. If a manual override path exists, define and document how preset and override
   interoperate (recommended: manual override disables preset controls for that
   thread to avoid competing precedence).

## Persistence, migration, and data interchange

1. Bump the chat snapshot schema by one step and add an ordered additive migration for
   `systemPromptPreset`.
2. Parse/validate preset only for the three known variants.
3. Include the value in hot persistence and deep snapshot tracking.
4. Persist the value in archive stubs so restored/snapshotted threads replay
   identically.
5. Persist in export payload and replace/merge import flows.
6. Invalid values are dropped to `undefined` at parse/merge boundaries.

## Required test coverage

1. New threads default `systemPromptPreset === undefined`.
2. Branching behavior copies preset where expected.
3. v→v+1 migration preserves thread data and keeps preset unset when absent.
4. Export/replace-import/merge-import all preserve preset value.
5. Full/system-tools/micro composition includes the resolved user text according to
   precedence rules.
6. Micro composition preserves existing micro contract and includes resolved preset;
   bare remains empty.
7. Captured Ollama and OpenAI-compatible request bodies include expected preset text
   in the leading system message.
8. Agent UI control changes preset state and remains disabled where thread type
   forbids edits.

## Definition of done

- The follow-up task spec in `./DISPATCH.md` is implementation-complete and passing.
- All behaviors in scope are evidence-tested and documented.
- No unrelated schema, adapter, or platform boundaries are changed.

See [DISPATCH.md](./DISPATCH.md) for exact execution steps.

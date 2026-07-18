# SP-1 — user-configurable system prompt

**Status:** approved and implementation-ready

**Decision:** `APPROVED`

**Roadmap source:** `docs/roadmap.md`, SP-1 at lines 300–311

**Scope of this lane:** design and exact implementation handoff only; the
source implementation must run in a follow-up lane.

## Outcome

Users can keep global default instructions and optionally choose different
instructions for one conversation. A thread override replaces only the
user-authored global section. It never replaces GatesAI's built-in runtime,
tool, artifact, skill, or safety contracts. The same behavior works in Desktop
and Web Lite and reaches both Ollama and OpenAI-compatible request bodies.

## Corrected baseline

The roadmap premise is partly stale. The repository already has:

- `UserProfileStore.defaultSystemPrompt`, persisted in
  `gatesai.profile.v1` by `profileStorage.ts`;
- a global Instructions textarea on the Agent page;
- full-prompt composition through `UserProfileStore.composeSystemPrompt()`;
- provider serialization of `LlmRequest.systemPrompt` in both
  `ollama.ts` and `openaiCompat.ts`.

Do not rebuild or rename those pieces. The remaining gaps are:

1. there is no per-thread user-instruction override;
2. Ollama's default `micro` context mode replaces the full composition with
   `MICRO_LOCAL_SYSTEM_PROMPT`, so the existing global instructions do not
   reach the default Ollama wire request;
3. the new thread field needs a numbered chat-snapshot migration, archive and
   export/import coverage, and deep MobX persistence tracking;
4. the UI does not explain inheritance, explicit per-thread behavior, bare
   mode, or preservation of built-in contracts;
5. provider tests do not directly assert the user text in the system message.

## Product and data decisions

### One optional thread field, with three meaningful states

Add this to `Thread`:

```ts
systemPromptOverride?: string;
```

Its states are deliberately distinct:

| Stored value | Meaning | Effective user instructions |
| --- | --- | --- |
| `undefined` | inherit | current global `defaultSystemPrompt` |
| non-empty string | override | the thread string |
| empty string | explicit override | no user-authored instructions |

This lets someone temporarily suppress a global persona for one thread without
disabling the built-in GatesAI contracts. Whitespace may be preserved in
storage for textarea fidelity but is trimmed when composing a request. Clearing
the override removes the property (`undefined`) and resumes inheritance from
the current global value.

New threads inherit by omission. A branched thread copies the override,
including an explicit empty string, because model/context/skill choices already
carry into a branch and this setting is part of the same conversational
behavior. Read-only bundled threads cannot be edited. Background-agent task
threads keep their separate immutable task-prompt path; SP-1 must not silently
change scheduled or running task behavior.

### Prompt precedence by context mode

Keep one resolver in `UserProfileStore` for effective user instructions:

```text
thread override (when defined) > global default > no custom section
```

Then preserve these mode semantics:

| Context mode | Built-in content | User-configured content |
| --- | --- | --- |
| `full` | full Desktop/Web Lite/headless harness, runtime, memory/context, later tool/skill/artifact addenda | effective thread/global instructions |
| `system-tools` | same normal harness and tool contracts, reduced chat history | effective thread/global instructions |
| `micro` | existing minimal local/tool contract only | effective thread/global instructions under a clearly labeled section |
| `bare` | none | none; this mode explicitly means no system prompt or tools |

For normal and micro prompts, label the user section
`User-configured instructions:` and retain built-in copy stating that the
section supplements rather than replaces the runtime/tool contracts. Do not
concatenate global and override text: the override replaces only the global
user section. Do not sanitize or reinterpret intentionally user-authored prompt
text.

`systemPromptForContextMode` should accept the effective user text (or an
equivalent narrow callback) so `micro` can append it without pulling the full
profile/memory prompt into small local contexts. This is the composition seam
SP-2 can later use to slim built-in sections without dropping SP-1 text.

Direct image turns and background agent tasks retain their current dedicated
prompt paths. The `bare` exception must be stated in Agent-page help text so
the UI never promises that instructions are sent when the user explicitly
selected no-system-prompt mode.

## Settings interaction

Extend the existing Agent → Instructions section; do not add a new route,
modal, composer control, dependency, or preset system.

1. Rename the existing label to **Default instructions**. Explain that it is
   the global default, that built-in tool/runtime rules remain active, and that
   bare mode intentionally sends no system prompt.
2. Add a **Current conversation** subsection for an editable normal thread.
   Show the active thread title and a checkbox/switch labeled **Use different
   instructions for this conversation**.
3. Off means `systemPromptOverride === undefined` and shows **Using global
   default**. Turning it on writes `''` immediately and reveals a textarea.
4. The textarea edits the thread field live through a public
   `ChatStore.setThreadSystemPromptOverride(threadId, value)` action. A
   **Use global default** action clears the property back to `undefined`.
5. An empty enabled textarea is valid and is described as “No custom
   instructions for this conversation; built-in rules still apply.”
6. If there is no active thread, the thread is read-only, or it is an agent-task
   thread, show truthful non-editable helper copy instead of a control that the
   turn pipeline ignores.
7. Render this same store-backed section in Web Lite. No runtime checks should
   hide it and no Desktop bridge call is involved.

The separate Later item “Per-thread system-prompt presets (Coding / Writing /
Research)” remains out of scope. That feature can later populate this freeform
override without changing the SP-1 persistence contract.

## Persistence and migration

1. Bump `CURRENT_CHAT_SCHEMA_VERSION` from 3 to 4.
2. Register an explicit ordered 3→4 additive migration. Legacy v3 threads have
   no override and therefore inherit the global default; the migration stamps
   v4 without inventing text. Malformed non-string values are omitted at the
   parse boundary.
3. Parse `systemPromptOverride` with `stringField`, preserving `''`.
4. Copy the field into IndexedDB archive stubs when it is defined, including
   `''`, so cold/hydrated threads behave identically.
5. Touch it in `trackSnapshotDeep` so changing only the textarea schedules a
   save.
6. Preserve it through `prepareChatSnapshotForSave`, data export, replace
   import, and merge import. An otherwise-empty thread with an explicit
   override is not an import placeholder.
7. Keep the existing global prompt in `gatesai.profile.v1`; no key rename or
   second global source of truth is needed. Add a direct round-trip regression
   for the existing profile slot because it is part of SP-1 acceptance.

## Implementation slices

### 1. Model and storage

- Add and document `Thread.systemPromptOverride` in `src/core/types.ts`.
- Copy it in `branchThreadFrom` and test the non-empty and explicit-empty cases.
- Add the v4 migration and parser/archive/deep-tracking updates.
- Extend export/import placeholder handling and tests.

### 2. Composition and request parity

- Add an effective-user-instructions resolver to `UserProfileStore` and let
  `composeSystemPrompt` accept a thread override while retaining every existing
  harness/runtime/bio/summary/context/nudge section.
- Update `TurnProfile`, `TurnRunner.buildTurnRequest`, and
  `ChatStore.tokenUsageBase` together so the context meter estimates the exact
  prompt sent to the provider.
- Extend `systemPromptForContextMode` so micro includes the effective custom
  section after its built-in minimal contract; bare remains `undefined`.
- Leave `ollama.ts` and `openaiCompat.ts` behavior unchanged unless a failing
  wire test exposes a real adapter defect.

### 3. Agent settings surface

- Add the global-default and current-conversation controls described above to
  `Agent.tsx` using existing UI primitives and theme tokens.
- Add the narrow ChatStore setter/clear action; enforce existing read-only
  behavior.
- Cover Desktop and Web Lite component/E2E interaction, inheritance, explicit
  empty state, and truthful unavailable copy.

### 4. Documentation

- Update the system-prompt/context-mode sections in `docs/architecture.md` and
  `docs/tech_spec.md`.
- Update `docs/user-guide.html` Agent-page guidance with global-vs-thread
  behavior, the bare-mode exception, and built-in-contract preservation.
- Append `docs/changelog.md`. Do not edit `docs/roadmap.md`; the harvesting
  session owns the checkbox transition.

## Required test matrix

1. `gatesai.profile.v1` global text saves and reloads unchanged.
2. A v3 snapshot migrates to v4 and inherits globally; future-version backup
   behavior remains unchanged.
3. Non-empty and explicit-empty overrides round-trip through hot persistence,
   archive stubs, export, replace import, and merge import.
4. Global fallback, non-empty replacement, explicit-empty suppression, and
   whitespace-only composition all behave as defined.
5. Full/system-tools prompts keep the Desktop or Web Lite harness and all
   existing built-in sections while using the effective custom text exactly
   once.
6. Micro keeps `MICRO_LOCAL_SYSTEM_PROMPT`, contains the effective custom text
   exactly once, and does not pull in the full bridge/profile prompt.
7. Bare still sends neither system prompt nor tools.
8. `ChatStore.tokenUsage` uses the same override and mode as the outgoing
   request.
9. Branches copy non-empty and explicit-empty overrides; new threads omit it.
10. The Agent controls edit the global value, opt a thread in/out, preserve
    explicit empty, and render in both Desktop and Web Lite. Read-only and
    agent-task threads do not expose a misleading editor.
11. The captured Ollama `/api/chat` body starts with a `role: "system"`
    message containing the custom text and the micro built-in contract.
12. The captured OpenAI-compatible `/chat/completions` body starts with a
    `role: "system"` message containing the custom text and the full built-in
    harness.

## Verification

```sh
npm run ci
npm run test:e2e
```

No Rust, bridge, network, secret, dependency, or deployment work is required.
If Playwright cannot bind its Vite listener in a sandboxed implementation lane,
the orchestrator must run that command in its outside-sandbox verifier; do not
weaken or skip the suite.

## Definition of done

- All roadmap acceptance statements are evidenced by tests, including direct
  provider-body assertions.
- Desktop and Web Lite expose the same controls and persistence behavior.
- Built-in prompt contracts remain present in every non-bare applicable mode.
- Existing global prompt data remains compatible and is not renamed.
- Docs are true, `npm run ci` and `npm run test:e2e` pass, and the harvesting
  session can tick SP-1 without additional product decisions.

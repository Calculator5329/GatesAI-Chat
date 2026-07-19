# Follow-up implementation task

title: Implement and prove the <1.5s desktop cold-start budget

goal: |
  Implement PLAN.md at baseline 66b56b77ce782ebfe665a15542b8bb8edfc618ed.
  Report a painted primary-surface milestone from React to a Tauri process-start
  clock; keep all existing menu sections lazy; lazy-load registered dock panels
  so markdown is no longer eager; schedule only automatic OpenRouter/Ollama live
  catalog refreshes after the interactive paint with cancellable idle work;
  trim docs raster evidence and unused mobile/platform icon outputs from the
  bundled source snapshot; add deterministic eager-JS and snapshot-size gates;
  and record release-mode timing plus NSIS/AppImage size evidence. Acceptance is
  ten Linux release launches with p95 <1,500 ms, eager JS <=310 KiB gzip, source
  snapshot <=10 MiB raw, full frontend/E2E/Rust gates green, and no visual,
  persistence, release-name, or manual-refresh regression. Do not edit
  docs/roadmap.md; the harvesting session owns the checkbox.

owns:
  - src/app/App.tsx
  - src/app/InteractiveSignal.tsx
  - src/components/menu/GatesMenu.tsx
  - src/components/menu/menuSectionMeta.ts
  - src/components/dock/DockPanel.tsx
  - src/components/dock/panelRegistry.tsx
  - src/stores/RootStore.ts
  - src/services/startup
  - src-tauri/src/lib.rs
  - scripts/create-source-snapshot.mjs
  - scripts/audit-source-snapshot.mjs
  - scripts/check-startup-bundle.mjs
  - scripts/measure-cold-start.mjs
  - package.json
  - tests/app/InteractiveSignal.test.ts
  - tests/components/menu/GatesMenu.test.ts
  - tests/components/menu/SettingsWalkthrough.test.ts
  - tests/components/dock/panelRegistry.test.ts
  - tests/components/dock/DockPanel.test.ts
  - tests/stores/RootStore.startup.test.ts
  - tests/services/startup
  - tests/services/sourceSnapshot.test.ts
  - tests/scripts/startupBundleBudget.test.ts
  - tests/scripts/measureColdStart.test.ts
  - docs/architecture.md
  - docs/acceptance/cold-start-2026-07-18.md
  - docs/changelog.md

test-cmd: npm run ci && npm run test:e2e && npm run audit:startup && npm run audit:source-snapshot && cargo test --manifest-path src-tauri/Cargo.toml

implementation-notes:
  - Read the sibling PLAN.md before editing; its metric boundary, current
    bundle/snapshot evidence, exclusions, and non-goals are acceptance terms.
  - Use no new dependency. Keep persisted catalog restoration, secrets,
    explicit refresh, and Ollama pull/delete refresh immediate.
  - The bundle checker must traverse the Vite manifest's static closure and
    gzip real emitted files; never identify chunks by hashed filename.
  - The source audit and generator must call the same collector/policy.
  - The cold-start launcher may terminate only the child process it spawned.
  - A green timing claim requires durable raw samples and environment details
    in the owned acceptance doc; CI wall-clock timing is diagnostic, not a
    substitute for release-binary evidence.

# DISPATCH — execute the foundation surface manual acceptance

Read [PLAN.md](./PLAN.md) completely before running this task. It is the
authoritative scope, protocol, evidence format, and pass/fail policy.

## Task spec

- **title:** Manually accept the original foundation regression slice on real Tauri
- **goal:** On the exact current commit, execute every `FND-*` case in
  `PLAN.md` against a disposable real Linux Tauri profile plus its local-only,
  degraded, and Web Lite environments. Publish sanitized durable evidence and
  a strict `PASS` or `FAIL`. Do not test optional integrations, weaken the
  harness, change source, expose secrets, spend through silent fallback, or
  repair failures in the same lane. Every defect gets a separately owned
  follow-up task with its minimal reproduction.
- **owns:**

  ```text
  docs/acceptance/foundation-surface-<run-date>
  ```

  Replace `<run-date>` with the execution date before dispatch. Do not claim
  source, tests, roadmap, changelog, `.orc`, an existing app profile, or any
  workspace outside the dedicated disposable acceptance folder.

- **test-cmd:**

  ```sh
  NODE_ENV=test npm run ci && npm run test:e2e && TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Run the Playwright and Tauri/manual portions outside a listener-restricted
  sandbox. The `TAURI_CONFIG` override is the repository CI convention for
  testing Rust without a packaged sidecar; the real manual run must still use
  the matching bridge. `desktop-mocked` is supporting evidence only. Do not
  alter ports, skip projects, or substitute screenshots for interaction/effect
  checks.

## Completion contract

The task is complete only when `REPORT.md` contains the exact commit/build,
environment manifest, command results, every case verdict, sanitized evidence,
redacted network ledger, linked defect tasks, and final acceptance verdict.
A `FAIL` report is a valid completed QA run but does **not** close the roadmap
item. Only a `PASS` report authorizes the harvesting session to mark the item
done.

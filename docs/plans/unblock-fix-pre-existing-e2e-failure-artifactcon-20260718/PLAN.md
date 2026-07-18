# Artifact palette-to-dock E2E repair plan

Status: approved for execution (Ethan: `APPROVED`, 2026-07-18)

Roadmap item:

> Fix pre-existing e2e failure: artifactContract.spec.ts "opens a registry artifact from the palette in the dock" — dock-panel iframe [title="Preview of Status board"] never appears (fails identically on pre-merge master 7fbac5c; not a Wave-D regression; found 2026-07-18)

## Outcome

Make the registry artifact's human title the accessible name of its inline and fullscreen previews. The existing E2E must pass without weakening its selector, changing bridge fixtures, or bypassing the sandboxed preview path.

## Diagnosis

The palette-to-dock flow succeeds before the failing assertion:

1. `RootStore` refreshes the HTML registry after the mocked bridge becomes ready.
2. `CommandPalette` builds `Open artifact: Status board` from the registry record and calls `DockStore.openArtifact('status-board-1')`.
3. `HtmlArtifactPanel` resolves the canonical path and passes `label="Status board"` to `HtmlArtifactPreview`.
4. `HtmlArtifactPreview` displays that label in its metadata, but derives `name` from the path (`status-board-1.html`) and uses `name` for the iframe title.

The rendered iframe is therefore titled `Preview of status-board-1.html`, not `Preview of Status board`. The test's final locator cannot match even though the dock and preview component mounted successfully. The same mismatch exists at pre-merge master `7fbac5c`, confirming that this is the recorded pre-existing defect rather than a Wave-D regression.

## Implementation decision

In `src/components/editorial/HtmlArtifactPreview.tsx`:

- Keep the path-derived filename for file operations, especially the downloaded filename.
- Derive one human-facing display name as `label || filename`.
- Use the display name consistently for visible preview metadata, the inline iframe title, the fullscreen dialog label, and the fullscreen iframe title.
- Preserve filename fallback behavior for call sites that do not supply a label.
- Do not change document-policy injection, blob/data URL generation, bridge reads, artifact registry loading, dock state, or iframe sandbox permissions.

This fixes the product accessibility contract rather than changing the E2E to accept an implementation-only filename. A registry title is already the visible name in the palette and preview bar, so its iframe accessible name should agree.

## Regression coverage

Extend `tests/components/editorial/HtmlArtifactPreview.test.ts` to assert that a preview rendered with `label="Demo"` has:

- inline iframe title `Preview of Demo`;
- fullscreen dialog/iframe naming based on `Demo` after opening the preview.

Retain the existing `tests/e2e/artifactContract.spec.ts` assertion unchanged. It is the end-to-end acceptance test for registry refresh, palette selection, dock opening, bridge-backed preview loading, and human-title propagation.

## Verification

Run from the repository root:

```sh
NODE_ENV=test npm test -- --run tests/components/editorial/HtmlArtifactPreview.test.ts
npm run typecheck
npx playwright test tests/e2e/artifactContract.spec.ts --project=desktop-mocked
```

Then run the repository gates before integration:

```sh
NODE_ENV=test npm run ci
npm run test:e2e
```

The Playwright commands require an environment that can bind the configured Vite ports; the Codex workspace sandbox cannot perform that verification.

Environment note: this lane inherits `NODE_ENV=production`. React 19.2.5 intentionally does not export `act` from its production build, so component tests produce an unrelated `(0, act) is not a function` error unless the command explicitly sets `NODE_ENV=test`. With `NODE_ENV=test`, the current targeted component suite passes 11/11 before the planned change.

## Acceptance criteria

- Selecting `Open artifact: Status board` opens the HTML artifact dock panel.
- The loaded inline iframe is discoverable as `Preview of Status board`.
- Fullscreen accessibility naming uses the registry label when supplied.
- Unlabelled previews continue to use their filename.
- The existing iframe CSP and sandbox contract is unchanged.
- The targeted unit suite, typecheck, named desktop-mocked E2E, full CI gate, and full E2E gate pass in a port-capable verification environment.

## Out of scope

- Artifact registry schema or migration changes.
- Palette ranking or dock-layout changes.
- Bridge mock behavior or artifact preview loading changes.
- Changing the E2E expectation to the slugged filename.
- Roadmap/changelog edits in this lane; the harvesting session owns queue bookkeeping.

# Release checklist

Use this checklist for every GatesAI Chat desktop release. Release assets are
published from the private source repository to the public
`Calculator5329/GatesAI-Chat-releases` repository.

## Prepare

- [ ] Choose a semver version and update `version` in both `package.json` and
      `src-tauri/tauri.conf.json`. Confirm the values are identical.
- [ ] Add the release notes to `docs/changelog.md` and verify user-facing links
      and version references.
- [ ] Run `npm run ci`, `npm run test:e2e`, and
      `cargo test --manifest-path src-tauri/Cargo.toml`. Do not run the live,
      paid `npm run test:models` suite as a routine release gate.
- [ ] Merge the release-ready changes to `master`. Confirm the Web Lite deploy
      workflow succeeds, then smoke-test the Pages site at
      `https://calculator5329.github.io/GatesAI-Chat/` (load the app, start a
      chat with a configured key, and confirm desktop-only features show their
      Web Lite state).

## Tag and build

- [ ] Create and push a tag exactly matching the app version, in the form
      `v<semver>` (for example, package version `4.6.0` uses tag `v4.6.0`).
- [ ] In GitHub Actions, confirm **Release desktop builds** was triggered by the
      tag push and both the `windows` and `linux` jobs succeed. A manual
      `workflow_dispatch` is useful for build validation, but its artifacts are
      not published as a release because publish steps require a tag ref.
- [ ] Confirm the workflow checked out the intended bridge ref, built both
      bridge sidecars, created the source snapshot, and completed the Tauri
      NSIS and AppImage builds.

## Verify published assets

- [ ] In the workflow run, download and inspect build artifacts
      `GatesAI-Chat-windows-setup` and `GatesAI-Chat-linux-appimage`.
- [ ] In the public release for the new tag, verify both stable asset names are
      present and non-empty:
      - `GatesAI-Chat-Setup-x64.exe`
      - `GatesAI-Chat-x86_64.AppImage`
- [ ] Follow the README's latest-download links in a signed-out browser and
      confirm each resolves to the matching asset in the public releases repo.
- [ ] Install and launch the Windows installer. Mark the AppImage executable,
      launch it on Linux, and confirm each app reports the new version and can
      connect to its bundled bridge.

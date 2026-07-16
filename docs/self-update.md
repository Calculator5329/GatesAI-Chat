# Self-update safety contract

GatesAI can improve a managed copy of its own source, verify that copy, and
produce an installer. It cannot silently replace the running app. This document
is the authority boundary for the desktop self-improvement loop.

## Authority by state

| State | What GatesAI may do | What remains outside its authority |
| --- | --- | --- |
| Installed app | Read the bundled source manifest and report availability | Rewrite the live installation, restart itself, enroll an updater, or install a package |
| Bundled snapshot | Copy the build-time snapshot into app-local data | Modify the bundled snapshot in place |
| Prepared source workspace | Read, search, write, stat, and list paths jailed below `source://` | Escape the managed root, follow a symlink, or write an arbitrary host path |
| Human review | Show changed files and diffs; revert an individual file to the bundled snapshot | Hide changes or treat model output as reviewed |
| Build runner | Run one bounded `install`, `test`, `build`, or `package` job against the prepared copy | Run a second concurrent job or target the live installation |
| Installer handoff | Report the generated artifact and open its containing folder | Execute the installer or approve an update for the user |

Web Lite has no source-workspace or build authority. The source tools are
desktop-only and fail closed when the Tauri commands are unavailable.

## Safe lifecycle

1. A release build bundles a source snapshot and manifest.
2. **Prepare** copies that snapshot into the app-local managed workspace.
   GatesAI refuses to replace a directory without a valid app-managed marker.
3. If a newer bundled snapshot makes the managed copy stale, **Prepare first
   archives the entire prior copy** under `source-workspace/archive/`, then
   creates the fresh copy. The archive root must be a real direct child of the
   managed workspace; symlinked or escaping archive paths fail closed. Edits
   are preserved; refresh is not deletion.
4. The assistant may edit only the prepared `source://` tree. The Workspace UI
   exposes the same tree for human review and per-file revert. Reverting a
   modified or newly added file first moves the current version under
   `source-workspace/archive/reverted-*/`, so the edit is preserved. All
   source operations reject symlinks in the root, intermediate directories,
   and target path.
5. The build runner performs install/test/build/package commands in that copy,
   one job at a time, and records its status and output.
6. Packaging ends at artifact discovery. GatesAI may open the output folder;
   the user decides whether to run an installer or update the live app.

If archiving or copying fails, preparation or revert returns an error. It does
not fall back to deleting the prior copy or file, or writing into the installed
application.

The jail rejects symlinks that exist when an operation resolves its path. It
assumes the app-local workspace is not being concurrently rewritten by a
hostile process running as the same OS user. Defending against that narrower
race requires directory-handle-relative filesystem operations and remains a
separate hardening decision; no model tool is granted access to the archive
root or its parent.

## Closure and future decisions

The current loop is closed through **edit → review/revert → test/build →
package → manual installer handoff**. It is intentionally not closed through
installation.

The following remain owner-gated future work:

- automatic or one-click installation;
- signing, update-channel enrollment, and restart orchestration;
- rollback of an installed release rather than a source-file edit;
- retention limits or user-confirmed archival cleanup;
- the recorded end-to-end demonstration.

Any future step that can alter the live installation needs an explicit design
decision, visible consent, failure recovery, and independent verification.

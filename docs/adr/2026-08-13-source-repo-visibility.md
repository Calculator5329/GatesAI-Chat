# ADR: GatesAI Chat source repository stays private

- Status: Accepted (owner ruling), with one owner action outstanding
- Date: 2026-08-13
- Ruling: `repo-visibility-packet-20260810`, D1 `q-gatesai-chat = adr`
- Owner note, verbatim: "private gates ai chat repo for now, no need to
  publicize it"

## Context

This project has always shipped through two repositories. The source lives in
`Calculator5329/GatesAI-Chat` and the built desktop installers publish to the
separate `Calculator5329/GatesAI-Chat-releases`, which the in-app download
links and the updater manifest point at. The split is real and load-bearing:
`.github/workflows/release.yml` pushes every artifact to the releases repo
using a `RELEASES_TOKEN` PAT, and the updater polls
`releases/latest/download/latest.json` there.

Nothing in the project said why the split existed, so the question reopened
roughly monthly. It sat on the Now list of `docs/roadmap.md` (work:274009eb)
from 2026-07-17 until this ruling.

Ethan answered the packet on 2026-08-13: keep the source closed, write the
reason down. That is what this record is.

## Decision

The source repository is private. Publication of the source is not a goal
right now, and no agent may change its visibility; visibility changes are
owner-only under the workspace rules.

The releases repository stays public. Downloads, the updater manifest, and the
Web Lite demo are the public surface of this product. The source is not.

Reasons, in the order they matter:

1. The owner does not want the source publicized right now. That is the whole
   decision; the rest is consequence management.
2. The split already works and is wired into the release pipeline. Collapsing
   it would mean re-pointing download links, the updater manifest, and the
   README, for no benefit the owner asked for.
3. The full git history has never been scanned for secrets. Publishing before
   that scan would be irreversible in practice, since anything leaked into a
   public history stays leaked.

## Measured state on 2026-08-13, which contradicts the packet's premise

The packet said the source repo was private. It is not. Measured on
2026-08-13 with `gh api repos/Calculator5329/GatesAI-Chat`:

- `private: false`, `visibility: "public"`
- `has_pages: true`, Pages served from the `master` branch through the
  Actions workflow, at `https://calculator5329.github.io/GatesAI-Chat/`
- The releases repo is public as well, which is expected.

So the decision recorded above is not the current state of the world. Nobody
established when or why the repo became public; that was not investigated.
Making it private again is an owner-only action and is written up below.

## Consequences

- The recurring "should this be public" question is closed. Point at this
  record instead of reopening it.
- Making the repo private will take the public Web Lite demo down unless the
  account has a plan that allows Pages on private repositories. That demo is
  rung 1 of the GatesAI landing page ladder and is linked from the landing
  README and from `gatesai-landing`'s deploy plan. This is the one real cost
  of executing the ruling, and it is why the flip is presented to the owner as
  a choice rather than run blindly.
  Measured: Pages is enabled and public for this repo today. Not measured: the
  account's GitHub plan (`gh api user` returned `plan: null` under the token in
  use, which means the field was not visible, not that the plan is free).
- If the repo is made private, the Web Lite links in
  `../gatesai-landing/README.md` and in the landing page itself need a new
  target or need removing. Nothing was changed in that repo for this record.
- The history secret scan named in the roadmap acceptance criteria was never
  run. It is no longer a precondition for publishing, since publishing is off
  the table, but the history is public today, so the scan is now a
  post-exposure audit rather than a pre-publication gate.

## Owner action: make the source repository private

Owner-only. An agent may not run this: repository visibility changes are
reserved to Ethan under the workspace rules. Read the consequence above about
the Web Lite demo before running it.

Run in PowerShell:

```powershell
cd $HOME\projects\ai\gatesai-chat
gh repo view Calculator5329/GatesAI-Chat --json visibility
gh repo edit Calculator5329/GatesAI-Chat --visibility private --accept-visibility-change-consequences
gh repo view Calculator5329/GatesAI-Chat --json visibility
```

What changes: the source repository stops being readable by anyone but you.
Forks, stars, and the public Pages site attached to it are affected; GitHub
prints what it will do before it does it. The releases repository is a
different repository and is untouched.

How to verify: the last command prints `{"visibility":"private"}`, and
`https://calculator5329.github.io/GatesAI-Chat/` either still loads (plan
allows private Pages) or returns 404 (it does not).

How to undo: `gh repo edit Calculator5329/GatesAI-Chat --visibility public
--accept-visibility-change-consequences`. Undo restores visibility. It does
not restore stars or forks that were dropped, and anything already cloned
while the repo was public stays cloned.

If the Web Lite demo matters more than closing the source, the alternative is
to leave the repo public and reopen this record with a new ruling. Do not
resolve that conflict by editing this file; record a new decision.

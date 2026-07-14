# AGENTS.md — codex contract for this repo

**Read `CLAUDE.md` in this repo — every rule in it binds codex too**
(verify commands, hard rules, definition of done). The global codex
contract at `~/.codex/AGENTS.md` and the workspace digest at
`~/projects/CLAUDE.md` also apply.

Codex-specific reminders:
- Temp files → `~/.cache`, never `/tmp` (RAM tmpfs, has filled before).
- The sandbox cannot bind ports — tests needing a listener get reported
  as "needs outside-sandbox verification", not retried or weakened.
- Stage only files you created/edited; never `git add -A`.
- If dispatched by agent-orchestrator: stay inside your declared `owns`
  paths.

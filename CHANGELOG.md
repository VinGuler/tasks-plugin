# Changelog

## 0.1.1 (2026-11-11)

- Usage hook: the local log is opened without following symlinks and is readable by you only from
  the first write. `move-to-hosted` leaves the local usage log on the machine.

## 0.1.0 (2026-11-11)

- First release: the MCP server entry (OAuth, no token in files), the `tasks-workflow`, `wrap-up`
  and `continue` skills, the usage hook (v5, with local mode) for Claude Code, a Claude Code marketplace and a
  Gemini CLI extension.
- Local mode: the `tasks-local` and `move-to-hosted` skills; the first run asks hosted or local.

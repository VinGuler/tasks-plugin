# Changelog

## Unreleased

- README: install, update and remove steps for the supported tools only (Claude Code, Codex CLI,
  Antigravity CLI), tested on Linux; what each tool gets (MCP, skills, usage hook); local mode.
  Cursor, VS Code and the claude.ai / ChatGPT connectors are no longer listed: they didn't work
  well enough yet.

## 0.2.0 (2026-11-12)

- Codex: a usage hook (`hooks/codex-usage-hook.mjs`, v1) on Codex's own hook events: token counts
  per model request, the item from Tasks' status calls, sent after each turn (or written to the
  local log). A Codex manifest (`.codex-plugin/plugin.json`) with its own hooks file, so the
  Claude Code hooks never run under Codex.
- Claude Code usage hook: unchanged behaviour (v5); it now exports the helpers the Codex hook uses.

## 0.1.1 (2026-11-11)

- Usage hook: the local log is opened without following symlinks and is readable by you only from
  the first write. `move-to-hosted` leaves the local usage log on the machine.

## 0.1.0 (2026-11-11)

- First release: the MCP server entry (OAuth, no token in files), the `tasks-workflow`, `wrap-up`
  and `continue` skills, the usage hook (v5, with local mode) for Claude Code, a Claude Code marketplace and a
  Gemini CLI extension.
- Local mode: the `tasks-local` and `move-to-hosted` skills; the first run asks hosted or local.

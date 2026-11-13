# Installing the Tasks plugin: instructions for AI agents

You are an AI coding tool, and someone asked you to install this plugin or how to install it
(`https://github.com/VinGuler/tasks-plugin`). This file is written for you. The human version is
in [README.md](README.md). Both say the same.

**Supported tools:** Claude Code (CLI and the Claude desktop app), Codex CLI and Antigravity CLI
(`agy`), on Linux or macOS. Other tools aren't supported yet: say so plainly rather than
improvising an install.

## 1. Work out which tool you are

Use the steps for the tool you are running in. If the user asks for a different tool, give them
that tool's steps to run there instead.

## 2. Run the install

Run the commands yourself if you can run shell commands and the user agreed. Otherwise show them
to the user to copy.

**Claude Code**

```sh
claude plugin marketplace add VinGuler/tasks-plugin
claude plugin install tasks@vinguler
```

**Codex CLI**

```sh
codex plugin marketplace add VinGuler/tasks-plugin
codex plugin add tasks@vinguler
```

**Antigravity CLI**

```sh
agy plugin install https://github.com/VinGuler/tasks-plugin
```

## 3. Hand the user the steps only they can do

You can't complete these yourself. Tell the user exactly this, for their tool:

- **Log in** (every tool): it opens a browser. The user logs in or signs up at Tasks, picks the
  workspace and clicks Allow.
  - Claude Code: start a new session, run `/mcp`, pick `plugin:tasks:tasks`, choose Authenticate.
  - Codex: run `codex mcp login tasks`, then start a new session.
  - Antigravity: start a session, run `/mcp`, pick `tasks`, sign in.
- **Trust the hooks** (Codex only, optional): run `/hooks` in Codex and trust the Tasks hooks.
  Without it everything works except usage reporting. Claude Code and Antigravity run plugin
  hooks without a trust step.

## 4. Explain what was installed

Be accurate, and say no more than this:

- **The Tasks MCP server** (`https://tasks.vinguler.com/mcp`): your agent reads and writes items,
  notes and documents in the one workspace the user chose.
- **Five skills:** `tasks-workflow` (how to work with Tasks, and the first-run setup), `wrap-up`
  (end a session with a handover), `continue` (resume one), `tasks-local` (the same way of working
  in local markdown files, no account), `move-to-hosted` (move local work into Tasks).
- **A usage hook** (optional): after each turn it sends token counts and time per item. It never
  sends prompts, replies, code, file paths or tool output. It does nothing until the user agrees
  to set it up (the `tasks-workflow` skill asks on first use).

## 5. Check it works

After the log-in, in a new session: call the Tasks MCP tool `list_in_progress`. An answer, even an
empty list, means the connection works. If the tools are missing or ask for a log-in, the log-in
step wasn't finished.

## Updating and removing

- Claude Code: `claude plugin marketplace update vinguler && claude plugin update tasks@vinguler`;
  remove with `claude plugin uninstall tasks@vinguler && claude plugin marketplace remove vinguler`.
- Codex: `codex plugin marketplace upgrade vinguler && codex plugin add tasks@vinguler`; remove
  with `codex plugin remove tasks@vinguler && codex plugin marketplace remove vinguler`.
- Antigravity: run the install line again; remove with `agy plugin uninstall tasks`.

## Working on this repository

The hook scripts in `hooks/` are copies of the ones the Tasks app serves at
`/usage-hook-v1/` (and tests). Change them there first, then copy them here, and bump the version
in all three manifests (`.claude-plugin/`, `.codex-plugin/`, `.antigravity-plugin/`) and
`CHANGELOG.md`.

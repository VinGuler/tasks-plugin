# Tasks for AI tools

Connects your AI tool to [Tasks](https://tasks.vinguler.com), a place where people and their AI
agents keep their work: projects, items, documents, resume cards, and the time and tokens spent on
each item. Each person can use a different tool. Everyone shares one workspace and picks up each
other's work.

**Supported tools:** Claude Code (CLI and the Claude desktop app), Codex CLI and Antigravity CLI
(`agy`). The commands below are for Linux and macOS.

## What gets installed

| | Claude Code | Codex CLI | Antigravity CLI |
| --- | --- | --- | --- |
| **Tasks MCP server** `https://tasks.vinguler.com/mcp`: items, notes, documents, roadmap. Browser log-in, no token to paste | `.mcp.json` | `.mcp.json` | `mcp_config.json` |
| **Skills**: `tasks-workflow`, `wrap-up`, `continue`, `tasks-local`, `move-to-hosted` | `skills/` | `skills/` | `skills/` |
| **Rules**: a short note telling the agent to use the skills | none | none | `rules/AGENTS.md` |
| **Usage hook** (optional): tokens and time per item, sent after each turn | `hooks/hooks.json`: runs as installed | `hooks/codex-hooks.json`: runs once you trust it | `hooks.json`: runs as installed |

Nothing else is installed. The hooks are small Node scripts in `hooks/` (Node 18 or newer). They
do nothing until the `tasks-workflow` skill has set up usage reporting with your agreement. That
writes one report-only token to `~/.tasks/config.json`, readable by you only. What the hooks read
and send: [Privacy](#privacy).

The first time you log in, you choose the workspace the connection may act in. You can revoke it
any time in Tasks, under Settings › API tokens. The first time you work with Tasks, the
`tasks-workflow` skill asks whether you want hosted Tasks or local mode (below), then offers to set
up usage reporting.

## Install

Each tool's install is two or three commands, then one log-in in your browser. If you'd rather
let your AI tool do it, open this repository in it (or give it the link) and ask it to install the
plugin: [AGENTS.md](AGENTS.md) tells it the steps for its own tool.

### Claude Code (CLI and the Claude desktop app)

```sh
claude plugin marketplace add VinGuler/tasks-plugin
claude plugin install tasks@vinguler
```

1. Start a new session, run `/mcp`, pick `plugin:tasks:tasks` and choose **Authenticate**.
2. Log in or sign up in the browser, pick the workspace and **Allow**.

There is nothing to trust: Claude Code runs a plugin's hooks as installed. The Claude desktop
app's Code sessions use the same setup, so they get the plugin too.

Update: `claude plugin marketplace update vinguler && claude plugin update tasks@vinguler`.
Remove: `claude plugin uninstall tasks@vinguler && claude plugin marketplace remove vinguler`.

### Codex CLI

Add this repository as a plugin marketplace, then install the plugin from it:

```sh
codex plugin marketplace add VinGuler/tasks-plugin
codex plugin add tasks@vinguler
codex mcp login tasks
```

1. The last line opens the browser log-in: log in or sign up, pick the workspace and **Allow**.
2. Start a new Codex session and run `/hooks`. Trust the Tasks hooks (`codex-hooks.json`): Codex
   runs a plugin's hooks only after you trust them. Skip this if you don't want usage reporting.

Update: `codex plugin marketplace upgrade vinguler && codex plugin add tasks@vinguler`. After an
update, `/hooks` asks you to trust the hooks again if they changed.
Remove: `codex plugin remove tasks@vinguler && codex plugin marketplace remove vinguler`.

### Antigravity CLI (agy)

```sh
agy plugin install https://github.com/VinGuler/tasks-plugin
```

1. Start a session, run `/mcp`, pick `tasks` (it shows as needing a log-in) and sign in.
2. Log in or sign up in the browser, pick the workspace and **Allow**.

There is nothing to trust: the hook runs at the end of each turn, and `/hooks` lists it.

Update: run the install line again. Remove: `agy plugin uninstall tasks`.

## Local mode (no account)

The `tasks-local` skill gives you the same way of working, kept as markdown files in your project's
`.tasks/` folder: items, statuses, resume cards, notes, documents and the handover. Nothing is sent
anywhere. Choose it when the `tasks-workflow` skill asks.

- It needs a tool that can read and write files in your project. All three tools above can.
- There is no web app, no teammates and no measured time or tokens.
- The MCP server stays configured but unused, so you can skip its log-in.
- Move to hosted Tasks any time with the `move-to-hosted` skill.

## Updating

Updates are pull, not push: nothing changes on your machine until you run the update command for
your tool (listed under each tool above). When you do, you get whatever version is on `main`. See
[CHANGELOG.md](CHANGELOG.md) for what changed. After a Codex update that touched the hooks, `/hooks`
asks you to trust them again.

## Privacy

The MCP connection reads and writes only what you ask your agent to do in Tasks, in the one
workspace you chose. The usage hook reads the session transcript on your machine (in Codex: the
token counts Codex hands its hooks; in Antigravity: the token counts of its transcript) and sends
**counts only**: token numbers, the model name, session and agent ids, the item keys of Tasks' own status
calls and the label your agent gave itself. Never prompts, replies, code, file paths or tool output.
It stores its token in `~/.tasks/config.json` (readable by you only) and its progress in
`~/.tasks/state/` (Codex: `~/.tasks/codex/`, Antigravity: `~/.tasks/agy/`).

## Versions

Semver. The major version follows the MCP tool contract; see `CHANGELOG.md`.

## License

MIT

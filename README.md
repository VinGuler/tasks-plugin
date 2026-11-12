# Tasks for AI tools

Connects your AI tool to [Tasks](https://tasks.vinguler.com), a place where people and their AI
agents keep their work: projects, items, documents, resume cards, and the time and tokens spent on
each item. Each person can use a different tool. Everyone shares one workspace and picks up each
other's work.

**Supported tools:** Claude Code (CLI and the Claude desktop app), Codex CLI and Antigravity CLI
(`agy`). The commands below are for Linux and macOS.

## What you get

| | Claude Code | Codex CLI | Antigravity CLI |
| --- | --- | --- | --- |
| Tasks MCP server (browser log-in, no token to paste) | yes | yes | yes |
| Skills: `tasks-workflow`, `wrap-up`, `continue`, `tasks-local`, `move-to-hosted` | yes | yes | yes |
| Usage hook (tokens and time per item, optional) | yes | yes, once you trust it | no |

The first time you log in, you choose the workspace the connection may act in. You can revoke it
any time in Tasks, under Settings › API tokens. The first time you work with Tasks, the
`tasks-workflow` skill asks whether you want hosted Tasks or local mode (below). In Claude Code
and Codex it also offers to set up the usage hook.

## Install

### Claude Code

```sh
claude plugin marketplace add VinGuler/tasks-plugin
claude plugin install tasks@vinguler
```

Then in a session, run `/mcp`, pick `plugin:tasks:tasks` and choose **Authenticate**.

The Claude desktop app uses the same Claude Code setup, so its Code sessions get the plugin too.

Update: `claude plugin marketplace update vinguler && claude plugin update tasks@vinguler`.
Remove: `claude plugin uninstall tasks@vinguler && claude plugin marketplace remove vinguler`.

### Codex CLI

Add this repository as a plugin marketplace, then install the plugin from it:

```sh
codex plugin marketplace add VinGuler/tasks-plugin
codex plugin add tasks@vinguler
codex mcp login tasks
```

The last line opens the browser log-in. Start a new Codex session afterwards.

Codex runs a plugin's hooks only after you trust them, so to get the usage hook, run `/hooks` in
Codex once and trust it.

Update: `codex plugin marketplace upgrade vinguler && codex plugin add tasks@vinguler`.
Remove: `codex plugin remove tasks@vinguler && codex plugin marketplace remove vinguler`.

### Antigravity CLI (agy)

```sh
agy plugin install https://github.com/VinGuler/tasks-plugin
```

Then in a session, run `/mcp`, pick the `tasks` server (it shows as needing a log-in) and
authenticate.

Update: run the install line again. Remove: `agy plugin uninstall tasks`.

## Local mode (no account)

The `tasks-local` skill gives you the same way of working, kept as markdown files in your project's
`.tasks/` folder: items, statuses, resume cards, notes, documents and the handover. Nothing is sent
anywhere. Choose it when the `tasks-workflow` skill asks.

- It needs a tool that can read and write files in your project. All three tools above can.
- There is no web app, no teammates and no measured time or tokens.
- The MCP server stays configured but unused, so you can skip its log-in.
- Move to hosted Tasks any time with the `move-to-hosted` skill.

## Privacy

The MCP connection reads and writes only what you ask your agent to do in Tasks, in the one
workspace you chose. The usage hook reads the session transcript on your machine (in Codex: the
token counts Codex hands its hooks) and sends **counts only**: token numbers, the model name, session and agent ids, the item keys of Tasks' own status
calls and the label your agent gave itself. Never prompts, replies, code, file paths or tool output.
It stores its token in `~/.tasks/config.json` (readable by you only) and its progress in
`~/.tasks/state/` (Codex: `~/.tasks/codex/`).

## Versions

Semver. The major version follows the MCP tool contract; see `CHANGELOG.md`.

## License

MIT

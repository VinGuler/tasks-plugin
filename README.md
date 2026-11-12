# Tasks for AI tools

Connects your AI tool to [Tasks](https://tasks.vinguler.com), a place where people and their AI
agents keep their work: projects, items, documents, resume cards, and the time and tokens spent on
each item. One repository for every tool:

- **The MCP server** `https://tasks.vinguler.com/mcp`. You log in (or sign up) in the browser the
  first time; no token to paste. You choose the workspace the connection may act in, and you can
  revoke it any time in Tasks, Settings, API tokens.
- **Skills** (`skills/`): `tasks-workflow` (how to work with items, notes and documents, and the
  one-time setup), `wrap-up` (end a session with a handover) and `continue` (start where the last
  session stopped).
- **A usage hook** (Claude Code and Codex, optional): reports tokens and time per item after each turn.
- **Local mode** (`tasks-local`, `move-to-hosted`): the same way of working on markdown files in
  your project's `.tasks/` folder, with no account and nothing sent anywhere; move it to hosted
  Tasks whenever you like. The skill asks which mode you want the first time.

## Install

**Claude Code**

```sh
claude plugin marketplace add VinGuler/tasks-plugin
claude plugin install tasks@vinguler
```

Then `/mcp`, pick `plugin:tasks:tasks`, Authenticate. The first time you work with Tasks, the
`tasks-workflow` skill offers to set up the usage hook.

**Gemini CLI, Antigravity**

```sh
gemini extensions install https://github.com/VinGuler/tasks-plugin
```

Then `/mcp auth tasks`.

**claude.ai, ChatGPT, Grok** (custom connector): add a connector with the URL
`https://tasks.vinguler.com/mcp` and leave the OAuth fields empty. Tasks registers the client
itself; log in and Allow.

**Codex**

```sh
codex mcp add tasks --url https://tasks.vinguler.com/mcp
codex mcp login tasks
```

Usage reporting (optional): in Tasks, Settings, AI usage reporting, create an install command and
run its Codex line (`… | node - --codex --url … --token …`). It adds the usage hook to
`~/.codex/hooks.json`; trust it once in Codex with `/hooks`. The plugin also carries a Codex
manifest (`.codex-plugin/plugin.json`, hooks in `hooks/codex-hooks.json`) for installing it as a
Codex plugin; Codex runs a plugin's hooks only once you trust them, and its docs say only for
plugins installed by hand in the desktop app, so the command above is the sure way.

**Cursor, VS Code (Copilot) and other MCP clients:** add an HTTP MCP server named `tasks`
with the URL `https://tasks.vinguler.com/mcp` and log in when the tool asks. Tools that
read Agent Skills can use the `skills/` folders as they are; copy them where your tool looks for
skills. These tools change their formats often: if a step here is out of date, their own MCP docs
win.

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

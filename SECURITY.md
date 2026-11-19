# Security

## Reporting a problem

Please don't open a public issue for a security problem. Email
[support@vinguler.com](mailto:support@vinguler.com) with "Security" in the subject: what you found,
how to reproduce it, and what it affects (this plugin, or the Tasks app it connects to). We reply as
soon as we can and tell you when it's fixed.

## What this plugin runs on your machine

- **Skills** are instructions for your agent; they run nothing by themselves.
- **The MCP server** is remote (`https://tasks.vinguler.com/mcp`). Your tool signs in with OAuth in
  your browser; no token is written into the plugin's files. You can revoke the access in Tasks,
  under Settings › API tokens.
- **The usage hooks** in [`hooks/`](hooks) are small Node scripts with no dependencies. They do
  nothing until you agree to usage reporting. Then they keep one report-only token in
  `~/.tasks/config.json` (mode 600), read token counts on your machine and send counts only: never
  prompts, replies, code, file paths or tool output. A report-only token can record usage and
  nothing else: it can't read or change your work.
- **Local mode** sends nothing anywhere.

## Supported versions

Only the latest version on `main` gets fixes. Update with your tool's update command (README,
"Install details").

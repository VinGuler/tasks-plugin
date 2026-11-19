# Contributing

Thanks for helping. Issues and pull requests are welcome.

- **Bugs and ideas:** open an issue with your tool (Claude Code, Codex CLI or Antigravity CLI), its
  version, your OS, and what you expected. For security problems, see [SECURITY.md](SECURITY.md).
- **Pull requests:** keep them small and say what changes for the user. Skills are markdown in
  `skills/<name>/SKILL.md`; keep their wording plain and their steps short.
- **Versions:** a change that ships bumps the version in all three manifests
  (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.antigravity-plugin/plugin.json`)
  and adds a `CHANGELOG.md` entry. The major version follows the MCP tool contract.
- **Hooks:** the scripts in `hooks/` are copies of the ones the Tasks app serves (and tests). We
  change them there first and copy them here, so a pull request that touches them is applied by
  hand on our side.
- **Test** a change in at least one supported tool before you open the pull request, and say which.

By contributing you agree that your work is licensed under the [MIT License](LICENSE).

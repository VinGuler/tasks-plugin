---
name: move-to-local
description: Take a workspace from hosted Tasks (tasks.vinguler.com) to Tasks local mode — copies the `.tasks/` folder of a Tasks export (Settings › Export, a zip) into the project, so its items, notes, documents, roadmap and handover can be worked on as markdown with nothing sent anywhere. Use when the user says "move to local", "work offline", "take my tasks local", or hands you a Tasks export zip.
---

# Move hosted Tasks to local mode

1. **Get the export:** the workspace's owner or an admin downloads it in Tasks: Settings › Export ›
   "Download everything" (`tasks-<workspace>-<date>.zip`). Ask the user for its path. You can't
   download it yourself: exports need a signed-in session, not the MCP token.
2. **Look before copying:** list the zip (`unzip -l <zip>`, or your tool's own way) and check it
   has `.tasks/config.json`. An older export without it is format 1: say so and stop (export
   again). Count what's inside: projects (from `config.json`), `items/`, `docs/`.
3. **Don't overwrite:** if the project already has a `.tasks/` folder, stop and ask: keep it, or
   move it aside (`.tasks.bak-<date>/`) first. Never merge two `.tasks/` folders.
4. **Copy:** extract only `.tasks/` into the project root (`unzip <zip> '.tasks/*' -d <project>`).
   The zip's `workspace.json`, `documents/` and `projects/` aren't needed locally; leave them in
   the zip.
5. **Check it reads:** open `config.json` (`"mode": "local"`, the projects and their `next`), one
   item and one document. Items are open work only: the Trash stays in the export's
   `workspace.json`.
6. **Usage (optional):** for local usage counts, write `~/.tasks/config.json` as
   `{"mode": "local"}` (see `tasks-local`); otherwise leave it as it is.
7. **Tell the user** what came over (projects, items by status, documents, roadmap entries,
   handover) and that from now on the `tasks-local` skill applies. Suggest committing `.tasks/`.
   Nothing changed in hosted Tasks: the workspace is still there until they delete it.

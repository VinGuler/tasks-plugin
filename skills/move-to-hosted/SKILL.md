---
name: move-to-hosted
description: Move a project from Tasks local mode (markdown in `.tasks/`) to hosted Tasks (tasks.vinguler.com) — connects the MCP server, then recreates the projects, documents and items with their notes and resume cards, keeping the old keys in the notes. Use when the user says "move to hosted", "upload my local tasks", "switch from local to Tasks online".
---

# Move local Tasks to hosted Tasks

1. **Connect:** the Tasks MCP tools must be available (see `tasks-workflow`, "First run:
   connect"). Ask the user which workspace to use; the grant they approve decides it.
2. **Check before writing:** read `.tasks/config.json`, count the projects, documents and items, and
   tell the user what will be created. Ask before going on. Nothing is deleted locally.
3. **Projects:** `list_projects`; reuse a project with the same key, else `create_project` with the
   key and name from the config.
4. **Documents first** (epics need them): `create_document` per file in `docs/`, with its title,
   content and summary as `ai_summary`, in a folder `projects/<project name>/`. A local `approved`
   document needs approval in Tasks: `approve_document`, or ask the user if you may not. Keep a map
   slug → new document key.
5. **Items, epics before their tasks:** `create_epic` / `create_item` with the title, description
   and type; pass `documents` (the new keys) and `epic` (the new epic key). Then:
   - `set_resume` with the Resume section;
   - one `log_work` with the old key and the notes, shortened to 600 characters
     (`Moved from local APP-3. <latest notes>`);
   - the status with `set_status` (`IN_PROGRESS` or `DONE`; measured time starts from the move, not
     from the local dates).
   Keep a map old key → new key.
6. **Handover:** if `.tasks/handover.md` exists, write it as the user's handover document (see
   `wrap-up`), with the old keys replaced by the new ones.
7. **Usage log:** `~/.tasks/usage.jsonl` (local usage) is not uploaded; it stays on the machine.
   If you read it, skip lines that don't parse as JSON.
8. **Finish:** write the key map to `.tasks/moved.md`, set `"mode": "hosted"` in `.tasks/config.json`
   (and in `~/.tasks/config.json` run the usage setup of `tasks-workflow` if the user wants usage
   reporting), and tell the user what was created. Suggest removing `.tasks/items` and `.tasks/docs`
   only once they have checked Tasks.

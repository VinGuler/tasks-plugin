---
name: tasks-local
description: Tasks without an account — the same way of working (items, statuses, resume cards, notes, documents, handover) kept as markdown files in a `.tasks/` folder of the project, nothing sent anywhere. Use when the project has a `.tasks/` folder with `config.json` saying `"mode": "local"`, or the user chooses local mode in the tasks-workflow setup.
---

# Tasks in local mode

Everything lives in the project's `.tasks/` folder and is read and written with your own file
tools. No server, no database, nothing leaves the machine. Use the same habits as hosted Tasks
(the `tasks-workflow` skill): short items, the why in documents, a current resume card, notes at
milestones, status that tells the truth.

## Layout

```
.tasks/
  config.json            {"mode": "local", "projects": {"APP": {"name": "My app", "next": 4}}}
  items/APP-1.md         one file per item
  docs/<slug>.md         one file per document
  handover.md            the session handover (wrap-up / continue)
```

**First use:** create `.tasks/config.json` with one project: ask the user for a short key (2-5
capital letters) and a name. Suggest adding `.tasks/` to version control; it is plain text.

**An item** (`items/<KEY>-<n>.md`; take `n` from the project's `next`, then increase `next`):

```markdown
---
key: APP-3
type: TASK            # EPIC, TASK or BUG
title: Export the report as CSV
status: IN_PROGRESS   # TODO, IN_PROGRESS or DONE
epic: APP-1           # optional
docs: [csv-export]    # optional: slugs in docs/
started: 2026-11-11T09:30:00Z
done:                 # set when DONE
---

A line or two on what the work is.

## Resume

Where it stopped and the exact next step.

## Notes

- 2026-11-11 10:05 — what was done, decisions, commits (at most 600 characters each)
```

**A document** (`docs/<slug>.md`): front matter `title`, `status` (`draft` or `approved`) and
`summary` (2-3 sentences, kept current), then the content. An epic needs an approved document.

## The habits, in files

- **Pick up an item:** read its front matter, its Resume and its last three notes, and the summary of
  its documents; not every file.
- **What's in progress:** the items with `status: IN_PROGRESS` (search the front matter, e.g.
  `grep -l "status: IN_PROGRESS" .tasks/items/*.md`).
- **Start:** set `status: IN_PROGRESS` and `started`. **Finish:** `status: DONE` and `done`.
- **Milestones:** add a dated line under Notes; rewrite Resume whenever the next step changes.
- **Handover:** `wrap-up` writes `.tasks/handover.md` (next step, running or paused, open
  questions, recent decisions) instead of a Tasks document; `continue` reads it first.
- **Usage (Claude Code with the plugin, optional):** write `~/.tasks/config.json` as
  `{"mode": "local"}` (readable by the user only) and the usage hook appends counts to
  `~/.tasks/usage.jsonl` instead of sending them. It needs hook version 5 or later.

## Moving to hosted Tasks later

The `move-to-hosted` skill connects the Tasks MCP server and copies these files into a Tasks
workspace.

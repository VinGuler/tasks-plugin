---
name: wrap-up
description: End a working session with Tasks so the next one (a new conversation, another tool, a teammate) can continue on a clean context — writes a short handover document in Tasks, brings the resume cards of the items you touched up to date, and checks nothing is left half-done. Use when the user says "wrap up", "hand over", "I'll continue later / in a new chat", or the context window is getting full.
---

# Wrap up a session

1. **Items you worked on:** for each, `set_resume` with where you stopped and the exact next step,
   and `log_work` if something since the last note matters (decisions, commits, what is blocked).
   Leave the status as it really is: `IN_PROGRESS` if work remains, `DONE` only if finished.
2. **Your handover document:** one per person, titled `Session handover (<your Tasks username>)`
   (`search` finds it). If you don't know the user's username: `list_members`; with one member it's
   theirs, otherwise ask once. Create it the
   first time (`create_document`, at the documents root or in a `handovers/` folder), otherwise read
   it with `lock: true` and rewrite it (`update_document` with its `version`). Keep it short:
   - **Next step:** the one thing the next session does first, with the item key.
   - **Running or paused:** anything still in flight (a build, a deploy, a background job) and how to
     check on it.
   - **Open questions** for the user, and **waiting for the user** (or "nothing").
   - **Recent decisions** the next session must not re-ask.
   Write a fresh `ai_summary` (2-3 sentences); `release` the lock.
3. **Outside Tasks:** if you changed files in a repository, say whether they are committed and
   pushed. Don't commit or push on your own unless the user asked.
4. **Tell the user** in three lines: what was done, the next step, what waits for them.

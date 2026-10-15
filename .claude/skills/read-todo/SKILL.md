---
name: read-todo
description: Reads the project to-do list in personal_notes/todo.md and reports what's open. Use when the user says "read todo", "show the todo list", "what's left to do", or asks what to work on next.
---
Read `personal_notes/todo.md` at the repo root and report from it. Don't edit
the file.

- With no other ask, list the open (`- [ ]`) items grouped by their `## `
  section, one line each, using the bold lead or first sentence. Skip ticked
  (`- [x]`) items, but say how many there are per section if any.
- If the user names a section or topic (e.g. "backend", "prayer list"),
  report only the matching items, in full.
- If the user asks what to do next, start with `## Next up`, then point out
  any open questions or decisions that block other items.
- Quote item text as written; don't add items or details that aren't in the
  file.

---
name: add-todo
description: Adds a new item to the project to-do list in personal_notes/todo.md. Use when the user says "add a new todo", "add a todo", "add to the todo list", or asks to note something down for later.
---
Add the item the user describes to `personal_notes/todo.md` at the repo root.

1. Read `personal_notes/todo.md` to see the current sections (`## ` headings)
   and how items are written.
2. Pick the section the item belongs in. If none fits, add it under
   `## Next up`. Create a new section only if the user asks for one.
3. Write it as an unchecked item, `- [ ] `, in the file's style:
   - Start with a short **bold** lead when the item needs more than one line,
     then the detail.
   - Name the files, types or queries it touches in backticks.
   - Keep sub-steps as indented `- [ ]` items under it.
   - Wrap lines at about 75 characters, indenting continuation lines two
     spaces, like the items around it.
4. Append it to the end of that section, unless the user says where it goes.
   Don't reword, reorder or tick off existing items.
5. If the request is unclear (what the item is, or which of two sections it
   belongs in), ask before writing.
6. Reply with the item as written and the section it went into. Don't commit;
   the user decides when to.

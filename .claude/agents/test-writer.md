---
name: test-writer
description: Writes unit and API tests for the C++ backend (GoogleTest), the database and API (pytest), the web app and the KMP shared module. Use after a change or when coverage is missing. Does not fix production code.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---
Write focused tests that match the style of the existing ones.

## Where tests live

- `backend/tests/*.cpp` — GoogleTest unit tests for code that needs no
  database. Register new files in `backend/tests/CMakeLists.txt`.
- `tests/test_*.py` — pytest against Postgres: schema, stored procedures and
  the GraphQL API end to end (resolver behavior and authorization belong here).
- Web and KMP have no test setup yet. If the task needs one, say so in your
  report rather than adding a framework unasked.

## Always cover the empty cases (CLAUDE.md)

- A user with zero people.
- A person with zero milestones and zero prayer burdens.
- A prayer burden with zero comments.
- A comment with and without a linked prayer burden.

Test fixtures read connection details from env vars. Never hardcode
credentials or database names.

## Report (keep it short)

- Test files added or changed.
- The command to run them.
- Whether you ran them: pass/fail. Paste only the failing assertions.
- Don't edit production code to make a test pass — bug-fixer does that.

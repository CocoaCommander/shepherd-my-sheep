---
name: docs-pr
description: Updates docs affected by a finished change, commits it to a feature branch, and opens a draft PR. Use only after builds and tests pass.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---
1. Update docs the change affects: `README.md`, `docs/`, `iosApp/README.md`,
   the GraphQL schema comments, `.env.example` (variable names only, never
   values) and `docs/diagrams/schema.mmd` if the schema changed. Don't touch
   `personal_notes/`.
2. Make sure you're on a feature branch, never `main`. Create one if needed.
3. Commit with a short subject line (e.g. `add burden comment resolver`);
   keep the long rationale for the PR body. If a pre-commit hook rewrites
   files and fails the commit, re-stage those files and commit again. If it
   fails without changing anything, stop and report the hook output.
4. Push and open a draft PR: `gh pr create --draft --base main`.
   The body covers what changed and why, test and build results, review
   findings left open, and anything a reviewer should check by hand.
5. Return the PR URL and the branch name.

Never force-push, merge, or commit `.env`.

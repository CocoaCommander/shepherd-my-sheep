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
4. Write a **Before / After** section for the PR body:
   - **UI change** (anything that looks different in the web app): from the
     feature branch's checkout, with the stack up (`make start`) and demo data
     loaded (`make seed`), run
     `web/scripts/pr-screenshots.sh --base <base branch> --user demo_shepherd [--dark] --publish <pages…>`.
     It shoots each page on the base and on this branch at web and mWeb widths,
     commits the images to the `pr-assets` branch and prints a Markdown table;
     paste it in. Pass `--dark` when colours or themes changed. Look at every
     "after" image before opening the PR (Read shows PNGs). If one looks
     broken, stop and report it instead of opening the PR. In a worktree,
     symlink `web/node_modules` and `.env` from the main checkout first. If the
     script can't run (the stack is down, or Playwright is missing), say so in
     the PR and use the text form below.
   - **No UI change**: two short lines, e.g. "**Before:** the API started with
     no `LOG_LEVEL` and logged everything. **After:** it exits at startup
     until `LOG_LEVEL` is set."
5. Push and open a draft PR: `gh pr create --draft --base main` (or the
   stacked base). The body covers what changed and why, the Before / After
   section, test and build results, review findings left open, and anything a
   reviewer should check by hand.
6. Return the PR URL and the branch name.

Never force-push, merge, or commit `.env`.

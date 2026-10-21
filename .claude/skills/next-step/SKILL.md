---
name: next-step
description: Picks the highest-priority open item in personal_notes/todo.md (optionally within one part of the list, e.g. UI, backend, housekeeping) and writes a stacked-PR plan file for /run-plan to execute. The plan's last step moves the todo items it ticked into the work log. Use when the user says "next step", "plan the next item", "what's next, plan it", or "/next-step <area>".
argument-hint: "[area: ui | backend | housekeeping | mobile | brand | <section name>]"
---
Write a plan for the next todo item. Plan only: don't write code, open
branches or PRs, or edit `todo.md`. `/run-plan` executes the plan, one
stacked PR per step, and the conversation is cleared between steps, so the
plan file must be the only thing the next session needs.

## 1. Pick the item

Read `personal_notes/todo.md` at the repo root (as `/read-todo` does; if
it's missing, say so and stop).

**With no argument**, take the first open (`- [ ]`) item in `## Next up`,
which is ordered by priority. If `## Next up` has no open items, say so and
ask which area to plan from; don't guess.

**With an argument**, match it to a `## ` section: first a case-insensitive
match on the heading text, then these aliases. If it matches none, or more
than one section, list the sections and ask.

| Argument | Section(s) |
|---|---|
| `ui`, `web`, `screens`, `frontend` | Screens (web + mWeb/mobile), then Brand |
| `backend`, `api`, `server` | Backend follow-ups |
| `housekeeping`, `chores` | Housekeeping |
| `mobile`, `android`, `ios`, `kmp` | Mobile apps |
| `brand`, `logo` | Brand |
| `cadence`, `contact` | New business rule: contact cadence |
| `next` | Next up |

Within the section, items that also appear in `## Next up` come first, in
its order. Otherwise take items in file order, where an open sub-item under
a ticked parent is an item of its own.

**Skip** an item, and say which and why, when:
- it already has an open PR (`gh pr list --state open`) or a plan in
  `~/.claude/plans/` that covers it. If a plan exists and isn't finished,
  point the user to `/run-plan <plan>` instead of writing a second one.
- it is only a decision ("Decide on later: …", "Possible later: …") with
  nothing to build. Mention it as an open question if a later item needs it.

**Dependencies.** If the item says it depends on another open item (e.g.
rate limiting needs `peer_address` from the logging follow-ups), plan the
dependency as the first step(s) of the same plan, and say so. Take only
the part of the dependency the item needs; the rest stays in the todo.

Take one item and its open sub-items. If siblings are so small and close
(same file, same PR) that a separate plan would be silly, say so in the
report and offer to fold them in; don't fold them in without asking.

Tell the user which item you picked (quoted as written) before surveying.

## 2. Survey

- `git fetch`, then work from `origin/main`. Note its short hash as the
  survey commit.
- Read the files the item names and the code around them: entry points,
  tests, GraphQL operations / schema, migrations, as the item needs. Note
  facts a cold session would otherwise have to rediscover: file and
  function names, existing helpers to reuse (not copy), test files and
  counts, gotchas.
- Check the `CLAUDE.md` Business Rules that apply (zero people / milestones
  / burdens / comments, contact cadence) and any decisions recorded in
  `todo.md` or the work log for this item.
- For UI items, check whether the design canvas has the screen; if the
  plan depends on reading it, make that a step 0 (no PR) as earlier plans
  did.

## 3. Resolve questions

Answer what the repo and the todo answer. Ask the user (AskUserQuestion)
about decisions that change the shape of the plan, e.g. scope, which of two
approaches, behaviour the todo leaves open. Record the answers under
**Decisions already made** with today's date. Anything left open goes under
**Open questions** with the step that depends on it; `/run-plan` asks
before starting that step. Don't invent answers.

## 4. Write the plan

Save it to `~/.claude/plans/<kebab-case-slug>.md` (pick a slug that isn't
taken). Follow the shape of the existing plans there (e.g.
`person-page-screen.md`):

1. **Title** and the "source of truth" preamble with the four "To start a
   step" lines, plus: "Before step 1, re-check this plan against anything
   merged to `main` since `<survey commit>`", naming the files to watch.
2. **Progress** table: `# | Step | Branch | Base | PR | State`. Step 1's
   base is `main`; each later step's base is the step before it. All
   states start empty.
3. **Handoff notes**: one line, "<today>: plan written from a repo survey
   at `<hash>`. Nothing started."
4. **Starting state** (the survey facts), **Decisions already made**,
   **Business rules that apply**, **Open questions**.
5. **Steps**: each a PR-sized change with its branch name, what to build,
   what to reuse, tests to add (what behaviour, incl. empty cases from the
   business rules), whether it needs a security review (auth, user input,
   SQL, secrets, CORS), and **Todo to tick**: the exact todo item text(s)
   the step completes, quoted, including copies under `## Next up`.
   Prefer few steps; one step plus the final step is fine for a small item.
6. **Final step: move ticked items to the work log** (always last, its own
   branch `<slug>-work-log`, based on the step before it). It:
   - collects every todo item ticked by this plan's steps (the "Todo to
     tick" lists plus anything Handoff notes added), as they now read in
     `todo.md` with their `(#N)`;
   - removes them from `personal_notes/todo.md`, and every copy under
     `## Next up`. A ticked parent that still has open children stays; if
     this plan ticked its last open child, the parent moves too. Don't
     touch items this plan didn't tick;
   - adds them to `personal_notes/work_log.md` under today's entry, in a
     `### Moved from the todo list` subsection grouped by `#### <todo
     section>`, worded as they were in `todo.md` (match the existing
     2026-10-21 entry). If today has no entry yet, start one as
     `/update-work-log` does, with a bullet per PR in this plan; if it has
     one, add to it;
   - is a docs-only PR (Before / After as two text lines), with nothing to
     tick itself.
7. **How every step works**: worktree under `.claude/worktrees/<branch>`
   (symlink `web/node_modules` and `.env`; remove the symlink before
   `git add`); draft PRs with the merge-order line ("Merge order: part N
   of M for <plan>. Merge after #<previous> (base `<base>`)…"); `gh pr
   edit` fails, use `gh api -X PATCH …/pulls/N -F body=@file`; terse
   commit subjects (memory: commit-message-style); tick todo items with
   the PR number in a follow-up commit on the same branch (memory:
   tick-todo-on-commit); Before / After in every PR body (memory:
   pr-before-after); the orchestrator pipeline (test-writer,
   build-checker, security-reviewer where noted, docs-pr); never push to
   `main`; one step per session. Add anything the survey found that every
   step needs (e.g. `make reset`, `npm run codegen` before `tsc`).

## 5. Report

Reply with: the item picked (and anything skipped, with why), the plan
path, the steps in one line each, open questions, and the command to start:
`/run-plan <slug>`. Don't commit; the plan lives outside the repo.

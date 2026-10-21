---
name: run-plan
description: Takes a plan file path, reads the plan, and starts its next unfinished step as one stacked PR. Use when the user says "run the plan", "carry on with the plan", "do the next step of the plan", or gives a plan file and asks to continue it.
argument-hint: <plan file path>
---
Run the next step of a stacked-PR plan. The plan file is the source of truth:
the conversation is usually cleared between steps, so take nothing from
memory of earlier steps that the file doesn't say.

**Find the plan.** The argument is its path. A bare name (with or without
`.md`) means `~/.claude/plans/<name>.md`. With no argument, list the most
recently changed files in `~/.claude/plans/` and ask which one; don't guess.

**Read it and pick the step.**
1. Read the whole file, not just the step.
2. In the Progress table, the next step is the first row not marked done.
   If every row is done, say so and stop.
3. If that row looks started (its branch exists, or a PR number with no
   "done"), resume it rather than starting over, and say so.
4. If the plan lists open questions and the step depends on one that has
   no answer, ask the user. Don't invent an answer.

**Check it's still current.** `git fetch`, then compare against what merged
to `main` since the plan's survey commit or the last Handoff note
(`gh pr list --state merged`). Look hardest at files the step touches. If
the step's base PR has merged, branch from `origin/main` and say so in the
PR. If something merged that changes the step, tell the user before
building on it.

**Do only that step.** Follow the plan's "How every step works" section (or
equivalent) and the step's own notes: branch name, base, worktree, tests,
reviews, todo items to tick, what to say in the PR. One step per session,
one PR per step:
- Work in a worktree under `.claude/worktrees/<branch>`.
- Open the PR as a draft against the step's base, with the merge-order line
  the plan asks for (which part of how many, merge after which PR).
- Tick the step's todo items with the PR number in a follow-up commit on the
  same branch.

**Before stopping, update the plan file.**
- Progress row: PR number and state, with today's date.
- Handoff notes: append what the next step needs (new files and names,
  gotchas, decisions made along the way, anything the plan got wrong).
  Don't rewrite later steps; if one needs to change, say so in Handoff and
  tell the user.

Then stop. Report the PR link, anything that didn't go as planned, and what
the next step is.

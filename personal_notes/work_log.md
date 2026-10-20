# Work Log

## 2026-10-20 — Contact clock restart; Prayer list API and screen

- **#56–#58 Prayer list screen** (web + mWeb) — three stacked PRs from
  the plan `~/.claude/plans/prayer-list-screen.md`, all merged that
  afternoon (#58's merge brought the stack into `main`). Rebuilds
  `/prayer` on the design system from the canvas (`Prayer.dc.html`,
  `PrayerMobile.dc.html`). The whole Prayer list section of
  [todo.md](todo.md) is now ticked.
  - **#56 Rows, sort, filter, Release with Undo** — each row: avatar,
    person link, status pill, "Added {ago}", the burden, the latest
    comment ("You" for your own), Comment and Release. Sort: Longest
    standing (default), Newest, By person (an h2 per person); ties break
    on id. Person filter, client-side. Release removes the row at once
    with an Undo toast (`unreleasePrayerBurden`); a failed release puts
    it back, a NOT_FOUND on Undo refetches. Empty states for zero people
    (rule 1), no burdens, and a filtered person with none. New
    `PrayerListBurden` fragment, `timeAgo` in `format.ts`, and
    `STATUS_BY_NAME` moved to `pages/personStatus.ts`.
  - **#57 Comment thread, Hide details, nudge, Recently released** —
    Comment expands the thread inline (latest two, "Show N earlier
    comments") with a comment box. Hide details switch masks burden and
    comment text, per device in `localStorage`, off by default. Burdens
    over 365 days old show "Still the right one to carry?" (text only).
    Recently released is a read-only 320px aside on web, after the list
    on mWeb, hidden when empty.
  - **#58 Add prayer burden, sharing line** — header button (a floating
    "+" on mWeb) opens a dialog: pick the person, write the burden.
    Disabled with zero people. "Everyone who shepherds {first} sees
    prayer burdens and comments." (`pages/sharing.ts`) sits under the
    add-burden box, each row's comment box, and the Person page's
    add-burden form.
  - **Decisions:** the Comment button expands inline (not on the canvas;
    decided by the user). The nudge and Recently released are text only,
    per the canvas. Copy not on the canvas (zero-people state, the add
    dialog, the sharing line) is flagged in each PR.
  - Security review on #57 and #58: no findings. Not clicked through in
    a browser: sign-in needs the seed password, which wasn't read.
- **#52–#54 Prayer list API** — three stacked PRs, merged before the
  screen work.
  - **#52** — burdens returned by root fields carry `person {id name
    status}` and `comments` (newest first, `[]` when none); a burden
    nested in a comment stays shallow. **Decision:** the burden's person
    is a `PersonRefDto`, so other `Person` fields selected there come
    back null.
  - **#53** — V008 `unrelease_prayer_burden` and
    `unreleasePrayerBurden(id)` (any shepherd, any time), and
    `recentlyReleasedPrayerBurdens(personId)`, the latest 5 of any age.
    Also fixes a flaky `parse_time` test helper. Needs `make reset` for
    V008.
  - **#54 Shared KMP** — the `PrayerListBurden` fragment, the recently
    released and unrelease operations, and `PersonRef.status`. No
    Android or iOS UI uses them yet.
- **#47–#49 Contact clock** — three stacked PRs, now merged: #47
  (base `main`), #48 (base `clock-1-backend`), #49 (base `clock-2-web`).
  Merged in that order. Implements the
  2026-10-16 decision that moving someone back to Active or New contact
  restarts their clock, and exposes the clock start so the UI needs no
  hard-coded window.
  - **#47 Backend** — V007 adds nullable `person.status_changed_at`.
    `update_person` stamps it only when the status actually changes.
    `person_contact_state` now starts the clock at
    `greatest(last contact or created_at, status_changed_at)`, with a new
    `contact_clock_start` column (null when not tracked).
    `Person.contactClockStart` in the API; CLAUDE.md rule 6 updated.
    - **Decisions:** only a manual move stamps; `log_contact`'s promotion
      and Undo's revert don't (a back-dated contact counts from its own
      date, and Undo leaves things as if the contact never happened).
      Re-saving the same status doesn't restart the clock. A contact
      logged after the move takes over. `statusChangedAt` isn't exposed.
    - The sqlfluff pre-commit hook reorders view columns (ST06), so
      V007's final SELECT has `-- noqa: ST06`.
  - **#48 Web** — Home's meter uses `contactClockStart` and
    `contactDueAt`; the hard-coded `WINDOW` is gone. New label "Moved to
    Active/New contact {n} ago" when a move started the clock; that copy
    isn't on the design canvas.
  - **#49 Shared KMP** — `Person.contactClockStart` mapped in the shared
    module. No Android or iOS UI uses it yet.
  - Security reviewer not run on #48 or #49 (display-only / one
    read-only field). Existing dev databases need `make reset` for V007.

**State at end of day:** everything above is merged to `main`
(`b2dd316`); this worktree is on `prayer-ui-3-add`. From the PR
descriptions (not re-run here): pytest 298 and test-seed 18 on a fresh
volume (#53), KMP 49 tests (#54), vitest 338 (#58). Existing dev
databases need `make reset` for V007 and V008. Open: nobody has clicked
through the new Prayer list in a browser yet. New todos from the day:
collapse comments in Recently released by default, and rename "Longest
standing" to "Oldest". See [todo.md](todo.md) for next steps.

## 2026-10-19 — Add person + Log contact

- **#37–#44 Add person + Log contact** — eight stacked PRs on top of #36
  (log contact API: required date and note, optional burden). Built from
  the design canvas: one **Log contact** dialog replaces the one-tap
  contact buttons, and a new **Add person** page starts the 72-hour
  clock. #37 and #38 merged that day; #39–#44 were left as drafts and
  merged the next morning.
  - **#37 Backend** — V006 adds `contact_log.promoted`, so Undo on a
    follow-up moves the person back to `new contact` if they are still
    `active`. `Comment.contactLogId` in the API. Person CHECKs: non-blank
    name, age 0-120, year met 1900 to the current year (UTC+14, so the
    web's check is never stricter than the server's).
  - **#38 Web components** — `Dialog`, required/optional field labels and
    error states, `DateField`, an undo toast hook, `StepsPanel`.
  - **#39 Log contact dialog** — date (required), comment (required),
    prayer burden (optional); Undo toast removes the contact, its note and
    burden. Today sends the current time, an earlier date sends 12:00
    local.
  - **#40 Person page** — contact status banner with a Log contact button;
    the page opens the dialog when sent there with `logContact` state.
  - **#41 Add person page** at `/people/new`, with a confirmation screen
    and "Log contact now". Replaces the inline form on My people.
  - **#42 Home** — cards always say "Log contact" and open the dialog;
    "Follow-up overdue" tag for new contacts; `quickContact` and its
    placeholder note are gone.
  - **#43 Shared KMP** — `logContact`, `deleteContact`, `contactAlerts`,
    contact fields on people; `lastContactDate` dropped from the model.
  - **#44 Wrap-up** — todo follow-ups, plus an end-to-end check.
  - **Decisions:** keep the 20 s toast (accessibility) instead of the
    brief's 8 s; the web never sends `isFollowUp`; back-dating before the
    person was added is allowed. Board drag from New contact to Active
    opens the Log contact dialog (confirmed, replaces that part of the
    2026-10-16 decision). Review now and the Board are left out until
    they're built.
  - **Checks:** `make test` 239, `make test-seed` 17, web 273,
    `:shared:allTests` passing; build clean. Manual run in headless
    Chromium passed with no console errors. Dev DBs need `make reset` for
    V006.
  - Seen, not filed: the Person details card's "Active: Yes" flag is easy
    to confuse with the `active` status (predates this work).

**State at end of day:** on main with #37 and #38 merged, #39–#44 open as
drafts (merge in order, retargeting each to main). Test counts are from
the plan's step 8 notes. Open follow-ups (Android/iOS dialog and Add
person, dark mode, exposing the clock start, dropping `lastContactDate`
from the API) are in [todo.md](todo.md).

## 2026-10-15 — Polished UI design started, contact cadence rule

- **Polished UI design started** in Claude Design, on the "Card & Gallery
  Views" canvas. First pass, not built yet; the screens are listed in
  [todo.md](todo.md) under Screens.
  - Web and mWeb mockups for Home (option B, care-first: people who need
    contacting up top), Review now, My people (Board / Gallery toggle),
    Person page (Maria Santos), Prayer list, and Sign in / register.
  - Brand: a simple vector sheep logo in brand green (`#3b6e4f`, head and
    legs `#2d5a3f`), used in every header. Still needs to become a real
    SVG asset and app icons.
  - Known mismatch: the Home mockup shows a never-contacted new contact as
    overdue; it should follow "72 hours from when they were added".
- **#21 Design workflow note** — `design_workflow.md`: ask Claude Design
  for realistic content and empty states, then hand off one screen per
  design by pasting its link into Claude Code.
- **#22 Design todos** — merged the design follow-ups (per-screen open
  questions, brand logo) into `todo.md`.
- **#25 Contact cadence rule** (business rule 6, now in `CLAUDE.md`) —
  active people contacted every 7 days, new contacts followed up within 72
  hours; a follow-up moves a new contact to active.
  - `V003__contact_log.sql`: a `contact_log` table replaces
    `person.last_contact_date` (backfilled, then dropped). The
    `person_contact_state` view is the one place the rule lives
    (OVERDUE / DUE_SOON / ON_TRACK / NOT_TRACKED). `log_contact` and
    `delete_contact` procs.
  - API: `contactState`, `contactDueAt`, `lastContactedAt`, `contacts`,
    `contactAlerts`, `logContact`, `deleteContact`. `lastContactDate` stays
    `@deprecated` until KMP migrates.
  - Web: contact-state badge, header bell with alert count, "N people need
    contacting" banner on My people (stands in for Home), "Contacted today"
    with Undo, "Followed up today" for new contacts.
  - Decisions: contacts are a log, not a date; a new contact with nothing
    logged has 72 hours from when they were added; a shared person alerts
    every shepherd and any shepherd's contact clears it.
  - Not clicked through in a browser yet. Existing dev databases need
    `make reset` for V003.
- **#19 make deps** — `make deps` installs the Python test packages;
  `reset`, `seed`, `reseed` and `test` check for them first, so `reset`
  no longer wipes the DB and then fails on a missing `nacl`.
- **#20 Block .env commits** — pre-commit hook plus a full-history check
  in the CI secrets job. `.env.example` is still allowed.
- **#24 Dev logs todo** — added a todo for a `make logs` target that
  follows API, web and Postgres together.
- **#23 Todo skills** (closed, not merged) — `/add-todo` and `/read-todo`
  for `todo.md`. They live in `~/.claude/skills` instead of the repo.

**State at end of day:** on main, pytest 167 and vitest 90 passing. Open
questions for contact cadence (what "active" means, the due-soon windows)
and the per-screen design questions are in [todo.md](todo.md), along
with next steps.

## 2026-10-14 — Web app feature-complete

All merged to main, in order.

- **#10 Person page actions** — record/remove milestones, add/release prayer
  burdens, add/delete comments (standalone or on a burden), with empty
  states for each. Remove, Release and Delete ask "are you sure?" inline
  first.
- **#11 Edit person** — inline form for name, status, age, year met, last
  contact and active; sends only changed fields so it doesn't overwrite
  another shepherd's edit. "Contacted today" button. Input length limits.
- **#13 Error codes** — API sets `errors[].extensions.code` (NOT_FOUND,
  CONFLICT, BAD_USER_INPUT, UNAVAILABLE, INTERNAL). Postgres messages never
  reach the client; they're logged instead. Web shows friendly messages and
  refetches when a record turns out to be gone or changed.
- **#14 Delete and unassign** — delete a person, remove another shepherd,
  stop shepherding yourself. The API refuses to remove the last shepherd
  (row lock so two removals can't race past it).
- **#15 Prayer list** — `/prayer` page of active burdens across all your
  people, each showing whose it is. Header nav links.
- **#16 Add shepherds** — new `searchUsers` query (name or username, 2–100
  characters, case-insensitive, wildcards escaped, excludes you, max 10).
  "Add shepherd" search on the person page.
  - Decisions: anyone signed in may search all users; all shepherds are
    equal (no owner role).
- Also merged today from other sessions: #12 sample data seed and the
  Makefile (`make test`, `make seed`, `make reseed`), #8 linters, #9
  Android debug cleartext, #7 multi-agent setup.

- **#17 Dev make targets** (draft) — `make start`, `stop`, `restart` and
  `reset` for the local stack (Postgres, API, Vite dev server), plus
  `make help`.
  - `start` rebuilds the API, waits for `/health`, runs codegen and starts
    Vite in the background (pid and log in `.dev/`, gitignored). It skips
    Vite if it's already running.
  - `stop` keeps the database. `reset` wipes it (`docker compose down -v`),
    starts fresh and loads the demo seed.
  - Vite runs as `node node_modules/vite/bin/vite.js` instead of
    `npm run dev`, so the saved pid is the server itself and `stop` leaves
    no orphan.
  - Tested start, stop and restart; `reset` not run yet because it wipes
    the local DB.
  - README has a new "Running locally" section.
- Started `todo.md` with the remaining work.

**State at end of day:** on main, API tests 116/116 and web tests 82/82,
and the web build passes. Found a duplicate CORS header on preflight
(harmless locally, breaks a cross-origin deploy). Next steps are in
[todo.md](todo.md).

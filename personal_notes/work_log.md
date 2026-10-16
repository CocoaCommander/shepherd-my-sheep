# Work Log

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

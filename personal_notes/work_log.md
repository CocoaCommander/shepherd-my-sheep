# Work Log

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

# Work Log

## 2026-10-21 — Housekeeping; prayer log; sign in screen; rate limiting; drop `lastContactDate`; clear age / year met; `forLog` UTF-8 / DETAIL; `searchUsers` UserSummary

- **#77 Housekeeping** (base `main`) — four of the five Housekeeping
  todo items in one PR. Removing the old worktrees is still open (the
  session wasn't allowed to delete them).
  - `web/vite.config.ts` reads `API_PORT` from the repo-root `.env` (or
    the shell) for the `/graphql` proxy, with no fallback. Only the dev
    server needs it: `vitest` and `vite build` still run without a `.env`.
  - `docs/diagrams/schema.svg` and `schema.png` regenerated from
    `schema.mmd` with mermaid-cli 11. Both were behind: the SVG since V003,
    the PNG since V004 (no `status_changed_at`, `promoted`, burden
    `contact_log_id`).
  - New project skill `run-plan` (`.claude/skills/run-plan/SKILL.md`):
    takes a plan file, picks the first Progress row not done, checks
    `main` for changes, does that one step as a stacked draft PR, then
    updates Progress and Handoff notes in the plan.
  - Todo list cleanup: completed items moved below, so `todo.md` holds
    open work (ticked parents stay where they still have open children).
    The Person page block was left alone because the open stack #71–#75
    ticks it; move it here once that merges.
- **#81 Prayer list: Recently released comments toggle** (draft, base
  `main`) — each released burden gets a "Show comments (N)" / "Hide
  comments" text button, collapsed by default, opening the same
  read-only thread as the list rows (`Thread`). No button when a burden
  has no comments. Also renames the sort label "Longest standing" /
  "Longest" to "Oldest". Supersedes the 2026-10-20 "no buttons in the
  panel" decision; names stay plain text.
- **Prayer log** (stacked drafts #84 → #85 → #86): shepherds record
  each time they pray for a person, and every shepherd of that person sees
  it.
  - **#84 DB + API** (base `main`) — `V010__prayer_log.sql`
    (`prayer_log`, `record_prayer`, `delete_prayer`), `Person.lastPrayer`
    (everywhere) and `Person.prayers` (detail), `recordPrayer(personId,
    prayedAt?)` and `deletePrayer(id)`. Only the recorder may undo; a
    deleted user's prayers stay as "Someone". Praying is not a contact
    (rule 6). Seed prayers for Maria, David (back-dated) and others.
  - **#85 Person page** (base #84) — a prayer box in Prayer burdens:
    Prayed, Another day (back-dated to local noon), the last-prayed line,
    inline Undo for 20 s, and the prayer history (newest 3, then "Show N
    earlier"). "Last prayed" row in the sidebar.
  - **#86 Prayer list** (base #85) — a Prayed button on each burden row
    (it records for the person), the "Last prayed for … by …" line under
    the comment (kept under Hide details), inline Undo for 20 s.
- **Sign in / register** (stacked drafts #89 → #90 → this PR): the
  login page rebuilt on the design system.
  - **#89 Page** (base `main`) — `LoginPage` on `TextField` /
    `PasswordField` / `Button` / `Alert` with its own `--sms-*` wrapper:
    brand panel beside the form on web, a short brand header on mWeb.
    Client-side field errors on submit (then live), a banner with
    `friendlyMessage` for server errors (wrong credentials show the
    server's "Invalid username or password"; "Username is already taken"
    goes in the banner too), Show / Hide password. `screenshots.mjs`
    gains `signed-out:<path>` and `register` targets.
  - **#90 Globals** (base #89) — `index.css` cut to resets; the old
    palette, its dark block, the bare `label` / `input` / `button` rules
    and the unused `ErrorMessage.tsx` are gone. Restored the few spots
    that leaned on them (phone People tabs, board / gallery switch, "Show
    prayer history").
- **Rate limiting** (stacked drafts #94 → #95 → #96 → this PR): login,
  register and `searchUsers` are limited in memory, and the clients say so.
  - **#94 Client address** (base `main`) — the listener uses extended
    connections, so `peer_address` is filled and logs name the client
    (`--> POST /graphql (from 172.23.0.1)`) instead of `unknown`.
    `ClientAddress.hpp` turns `::ffff:1.2.3.4` into `1.2.3.4`. 429s name
    the address in the log too.
  - **#95 Limiter** (base #94) — `RateLimiter.hpp`: token buckets (login
    + register per client IP, IPv6 by /64; `searchUsers` per user, 60 a
    minute, burst 20) and a failed-login backoff per username (5 free,
    then 1 s doubling to 15 min, the same for unknown usernames). Over
    the limit: HTTP 429, `Retry-After`, code `RATE_LIMITED`. New required
    env var `AUTH_RATE_LIMIT_PER_MINUTE` (about 10 in production, 1000
    for local dev); the API exits without it. An `unknown` address skips
    the per-IP bucket and logs a WARN.
  - **#96 Clients** (base #95) — web `friendlyMessage` and KMP
    `ShepherdException.Api.RateLimited` show the server's "Too many
    attempts…" / "Too many searches…" instead of "Couldn't reach the
    server". KMP's Apollo client now exposes HTTP error bodies.

- **#99 Drop `lastContactDate`** (draft, base `main`) — removed the
  deprecated `Person.lastContactDate` and `UpdatePersonInput.lastContactDate`
  from the schema, DTOs and resolvers. `updatePerson` no longer logs a
  contact (it was the last API path that logged one with no note, against
  rule 5); contacts go through `logContact` only. A client that still
  sends the input key gets no error and nothing is logged (the executor
  ignores unknown input keys). No client used it.
- **Clear age / year met** (stacked drafts #103 → #104 → this PR): a
  person's age and year met can be emptied once set.
  - **#103 DB + API** (base `main`) — in `UpdatePersonInput` an absent
    key leaves a field unchanged and `age: null` / `yearMet: null` clears
    it. `V011__clear_person_fields.sql` gives `update_person`
    `p_clear_age` / `p_clear_year_met` flags (a flag plus a value is an
    error). `null` on `name`, `isActive` or `statusId` is `BAD_USER_INPUT`
    ("Name can't be cleared"). `Args::isNull` tells a null key from a
    missing one. Clearing leaves the status and the contact clock alone.
    KMP still can't clear (todo under Mobile apps).
  - **#104 Edit person form** (base #103) — Age and Year met are no longer
    required once set and always show "(optional)"; emptying one sends
    `null` and the page drops the value without a reload.
- **#107 `forLog` UTF-8 / DETAIL** (draft, base `main`) — `forLog` caps
  on a UTF-8 boundary: a character straddling the cap is dropped whole
  (stepping back at most 3 bytes, so stray continuation bytes can't wipe
  the line). New `sqlErrorForLog` in `ErrorMapping.hpp` logs only the
  primary line of a Postgres error, without the `ERROR:  ` prefix, so
  `DETAIL` / `HINT` / `CONTEXT` (keys, whole failing rows) never reach the
  log. For class 22 SQLSTATEs the line is cut at its first `"` and
  `"..."` appended, since the bad value is quoted there and may hold
  quotes or newlines. Constraint names and our `RAISE` ids still log; the
  client response is unchanged.
- **#111 `searchUsers` UserSummary** (draft, base `main`) — `searchUsers`
  returns a new `UserSummary { id name username }` (`__typename`
  "UserSummary") instead of `User`, so account timestamps no longer reach
  other users. The executor serializes every DTO field whatever is
  selected, so the fix is a slimmer `UserSummaryDto` (and a resolver that
  reads only the three columns), not just the schema. `me` and the other
  user fields keep `User`; a new todo item covers switching
  `Person.shepherds`, `Comment.author` and the other co-shepherd fields.

### Moved from the todo list

Completed items as they stood in `todo.md` on 2026-10-21, by section.

#### Housekeeping

- **Vite dev proxy ignores `API_PORT`.** `web/vite.config.ts` proxies
  `/graphql` to a hardcoded `http://localhost:8080`, so changing `API_PORT`
  in `.env` breaks the web app in dev. Read `API_PORT` from `.env` (no
  fallback) the way the Makefile does. (#77)
- Regenerate `docs/diagrams/schema.svg` from `schema.mmd`. The PNG
  shows `comment.contact_log_id` (V004); the SVG doesn't yet. (#77)
- **Clean up the todo list.** Move completed items from
  `personal_notes/todo.md` into `personal_notes/work_log.md`, so the todo
  list only holds open work. (#77)
- **Skill for running a plan.** Make a skill that takes a plan file
  path, reads the plan, then starts its next unfinished step (one stacked
  PR per step). (#77)

#### New business rule: contact cadence

- Add the rule to the Business Rules list in `CLAUDE.md` (rule 6).
- **Decide how "contact" and "follow-up" are recorded.** A `contact_log` table (who, when as `timestamptz`, follow-up flag, note) replaces `person.last_contact_date`. Migration `V003__contact_log.sql` backfills existing dates.
- Backend: derive each person's contact state (overdue / due soon / on track / not tracked) and the date it is due. The `person_contact_state` view; GraphQL `contactState`, `contactDueAt`, `lastContactedAt`, `contacts`, `contactAlerts`, `logContact`, `deleteContact`. A follow-up promotes `new contact` to `active`.
- Alerts: in-app first. Header bell with a count, and a "needs contacting" banner on My people until Home is built. Decide later whether to push or email.
- Decided: a new contact with nothing logged has 72 hours from when they were added (`person.created_at`). Tom Becker is on track at first. **The Home design shows "Log first contact" as overdue; update it to match.**
- Decided: a shared person alerts every shepherd, and any shepherd's contact clears it for all.
- Decided 2026-10-16: undoing a follow-up also reverts the promotion. If that follow-up moved the person from `new contact` to `active` and their status hasn't changed since, Undo puts them back to `new contact`.
- Build it. (server #37, web #42) Today Undo of a follow-up doesn't undo the promotion to `active`, and the web app only offers Undo on a plain contact. `delete_contact` needs to know the follow-up caused the promotion (e.g. a flag on the `contact_log` row); then offer Undo on follow-ups too.
- **Expose the clock start (or the window) from `person_contact_state`.** The UI only gets `contactDueAt`, so Home's meter still hard-codes `WINDOW` (7 days / 72 hours) in `web/src/pages/HomePage.tsx` to find where the clock started. Return the start (e.g. `contactClockStart`) so Home can drop `WINDOW` and the Person page can draw its progress bar (Screens, Person page). (server #47, web #48)
- **Log contact API, from the user story.** (#36) A shepherd adds a person (`createPerson` takes an optional `comment`), and adding them is the first contact. Logging a contact takes a required date and note and an optional prayer burden (`LogContactInput.prayerBurden`, linked by `prayer_burden.contact_log_id`, removed on Undo). Any contact for a `new contact` is their follow-up; `isFollowUp` is deprecated and ignored. Migration `V005__contact_burdens.sql`.

#### Screens (web + mWeb/mobile)

- **Review now** (#61, #62): opens from "Review now" on Home and steps through overdue people, most urgent first. Each step hosts `LogContactForm` inline (`web/src/pages/LogContactForm.tsx`, written for this) with "Log contact" and "Skip for now"; Skip logs nothing and leaves the person overdue. The Finished screen lists each contact logged in the session, each with Undo.
- **My people** (#65, #66, #67):
  - **Board** (default): columns for New contact, Active, Inactive, Lost contact. Each card shows name, last contact, milestone progress, prayer count and its contact-alert state.
    - Drag a card between columns to change status (updates `status` via `updatePerson`). On mobile, tabs per status plus a "Move to" menu instead of dragging. (#66)
    - Keyboard and screen-reader alternative to dragging: a "Move to" menu on every card. (#66)
    - Toast with Undo after a move. (#65, #66)
    - Decided 2026-10-16: what a status move means for the contact rule. Moving to Inactive or Lost contact stops alerts; moving back to Active or New contact restarts the clock from the move. (The New contact to Active part, "Did a follow-up happen?" with Yes / No, was replaced on 2026-10-19; see below.)
    - Decided 2026-10-19: dragging New contact to Active opens the Log contact dialog instead of asking "Did they have a follow-up?" / "Move anyway". Since #36 any contact logged for a new contact is their follow-up and promotes them, so saving the dialog does the move; Cancel leaves the card where it was. There is no "move without a contact" path from New contact to Active. The design still just moves them; update it to open the dialog.
    - Build the clock-from-the-move part: `person_contact_state` needs to count from when the status last changed (e.g. a `person.status_changed_at`) when that is later than the last contact. (#47)
    - Persist the move optimistically and roll back if the mutation fails. (#66)
  - **Gallery**:
    - Remember the chosen view (board or gallery) per device, in `localStorage` (decided 2026-10-16). (#67)
- **Prayer list** (#56, #57, #58):
  - Sort: longest standing (default), newest, or grouped by person. Filter by person. (#56)
  - Each row: person, status, how long ago it was added, the burden, the latest comment, a Comment button with the count, and Release (with Undo). API ready (#52, #53). (#56)
  - Hide details switch that masks burden and comment text (for praying or scrolling in public). Remembered per device in `localStorage`, off by default (decided 2026-10-16). (#57)
  - Nudge on burdens that have been on the list for over a year ("Still the right one to carry?"). (#57)
  - "Recently released" panel (answered or closed prayers, with the last comment) as encouragement. The API is `recentlyReleasedPrayerBurdens` (#53): the latest 5 releases, of any age (decided 2026-10-20). (#57)
  - Add prayer burden: pick the person, then write it (the existing form lives on the person page). (#58)
  - Decided 2026-10-16: no visibility setting between co-shepherds, even though burden text can be sensitive (one seed comment says "keep this quiet"). Every shepherd of a person sees all of their prayer burdens.
  - Make sure every user knows that all shepherds of a person see all of their prayer burdens (and comments), e.g. a line by the add-burden and comment boxes. (#58)
  - **Expand / collapse comments on recently released prayers.** In the "Recently released" panel (`web/src/pages/PrayerListPage.tsx`), let each burden's comments expand and collapse; collapsed by default. (#81)
  - Change the sort label "Longest standing" (mWeb "Longest") to "Oldest" in `web/src/pages/PrayerListPage.tsx`, and update `PrayerListPage.test.tsx` to match. (#81)
  - **Record when shepherds pray for a person.** Save a timestamp
    (and which shepherd) each time someone prays for a person, e.g. a
    `prayer_log` table alongside `contact_log`. Recorded and shown on the
    Prayer list and the Person page. (#84, #85, #86)
- **Sign in / register**: same fields and rules as the old `LoginPage` (name up to 100, username up to 50, password at least 8 on register).
  - One screen, no tabs: Sign in by default, with a "New here? Create an account" link below the button (and "Already have an account? Sign in" when registering). On web, a brand panel beside the form; on mWeb, a short brand header above it. (#89)
  - Inline field errors on submit (missing name, username or password; password under 8 characters), a wrong-credentials banner, and a Show / Hide password toggle. (#89)
  - Use the friendly error messages from `web/src/errors.ts` for the banner. Never say which of username or password was wrong. (#89)
  - Build on the design system, not the old globals. `LoginPage` still uses `auth`, `card`, `stack`, `error` and the bare `input` / `button` / `label` rules from `web/src/index.css`, so in dark mode its text takes the old `--text` (#e8e6e3) from `body`. The Person page had the same bug (640px cap, light text on white cards; fixed in #78). Give the page its own wrapper like Home's (`.page` / `.main` with `--sms-bg` and `--sms-ink`) and use `TextField` / `PasswordField` / `Button` / `Alert`. Once it no longer uses them, delete the leftover globals and the old colour variables from `index.css`. (#90)
  - Checked 2026-10-16: the brand panel says only people you add as shepherds can see the people you care for. Reads are limited to a person's shepherds, but any co-shepherd can add more shepherds, so "people you add" isn't quite true. Decided: the copy says only a person's shepherds can see them.
- **"Log contact" modal** (#39, #42):
  - (#42) Until it's built, the buttons log a placeholder note
    (`QUICK_CONTACT_NOTE` in `web/src/contacts.ts`), since the API now
    requires one. Remove `quickContact` once the modal replaces it.

#### Design gaps (canvas vs API)

Found 2026-10-16 by checking the "Card & Gallery Views" canvas against
`schema.graphql`, the migrations and the resolvers. Undo of a follow-up
(contact cadence, above) and the recently-released query (Prayer list)
were already listed and aren't repeated here.

- **Decide where contact notes show.** The Review "Log your contact"
  note goes to `contact_log.note`, but "Last note" (Home, Review) and the
  Person page Notes read `comment`. Either `logContact` also creates a
  standalone comment, or the screens merge contact notes into the feed.
  Decided 2026-10-16: it becomes a standalone comment linked to the
  contact (`comment.contact_log_id`, one per contact); undoing the contact
  deletes it. `contact_log.note` is gone; `ContactLog.note` reads the
  linked comment. Migration `V004__contact_notes.sql`.
- **Per-person summaries on list queries.** (#35) `myPeople` and
  `contactAlerts` only run `rowToPerson`, so nested lists are empty
  (`operations.graphql` says never select them there). Home, My people
  and Review need, per person: milestone progress, active burden count,
  shepherds ("Shared with Grace Lin") and the latest note with its time.
  Done 2026-10-19 with summary fields: `recordedMilestoneIds` (not a
  count: milestones can be reached out of order), `activeBurdenCount`,
  `latestComment` (newest of any kind), and `shepherds` filled on list
  queries. The seed was brought in line with rules 5 and 6 in the same PR.
- **Undo a prayer-burden release.** The Prayer list toast offers Undo,
  but `release_prayer_burden` is one-way. Add an
  `unrelease_prayer_burden` function (new migration) and an
  `unreleasePrayerBurden(id)` mutation. (#53)
- **`PrayerBurden.comments` is never populated.** Nothing sets it, yet
  it's declared non-null. The Prayer list needs the count ("Comment (4)")
  and the latest comment with author and time; fill it in
  `activePrayerBurdens` (and wherever burdens are returned). (#52)
- **Person status on burdens.** `activePrayerBurdens` returns the
  person as `{id, name}` only; each Prayer list card shows a status pill.
  (#52)

#### Next up

- Click through the merged web app in a browser (`cd web && npm run
  dev`, http://localhost:3000). Tests pass on main, but nobody has clicked
  through the merged build yet.
- Decide where contact notes show (Design gaps). Blocks the Home,
  Review and Person builds, so settle it before they start.
- Per-person summaries on `myPeople` / `contactAlerts` (Design
  gaps). (#35) Every list screen in the canvas needs them.
- Finish the contact-cadence backend: the clock counts from a status
  move (`person.status_changed_at`), and expose the clock start. Needed
  by the My people board. (Undo of a follow-up reverting the promotion
  is done, #37.) (#47)
- Prayer list API in one pass: unrelease, `PrayerBurden.comments`,
  person status on burdens, recently released query (Design gaps and
  Prayer list). (#52, #53)
- KMP: add `contactState` / `contactDueAt` / `lastContactedAt`, `contactAlerts`, `logContact` and `deleteContact` to the shared module, and stop using `lastContactDate` there. (#43)
- Assumption to confirm: "active" means status `active`, not the separate `is_active` flag (they can disagree; nothing keeps them in sync). Confirmed 2026-10-16.
- Assumption to confirm: "due soon" is the last 48 hours before the weekly deadline and the last 24 hours before the 72-hour one. Confirmed 2026-10-16.
- `backend/src/main.cpp` falls back to `0.0.0.0` / `8080` when
  `API_HOST` / `API_PORT` are unset, against the no-defaults rule.
  Validate them in `AppComponent::validateEnv()` with the rest. (#31)
- **Home** (based on option B, care-first): people who need contacting, up top. Web and mWeb mocked up. (#32)
- No rate limiting on `searchUsers` or login. (#95)
  - Strategy (decided 2026-10-16): **token bucket**, which is the
    "leaky bucket as a meter" (same maths). It allows a small burst and
    never queues, so legitimate requests get no added delay. A leaky
    bucket used as a queue would hold connections open and slow real
    users, which is a poor fit for login.
  - Login and register: a bucket per client IP. Also count failed logins
    per username with exponential backoff, so an attack spread over many
    IPs on one account is still slowed. Reply the same way whether or not
    the username exists.
  - `searchUsers`: a bucket per user id (it requires sign-in).
  - Over the limit: HTTP 429 with `Retry-After`.
  - In memory is fine while there is one API instance; move to shared
    storage if it scales out.
  - Depends on the logging follow-up below: `peer_address` isn't
    populated today, so per-IP limits need the client address first
    (and `X-Forwarded-For` from a trusted proxy if one is put in front).
- Drop the deprecated `lastContactDate` (on `Person` and `UpdatePersonInput`) from the API. Since #43 only `tests/test_api.py` uses it. (#99)

#### Backend follow-ups (low priority)

- `update_person` can't clear a value once set (COALESCE treats null as
  "leave unchanged"), e.g. age or last contact date. Needs an explicit
  "clear" signal. (#103)
- `searchUsers` returns the full `User` type, so `createdAt`/`updatedAt`
  are visible to any signed-in user. A slimmer `UserSummary { id name
  username }` would hide them. (#111)

**Logging follow-ups from #30**:

- Client address always logs as "unknown": `peer_address` isn't
  populated on the connection in `RequestLogger.hpp`. (#94)
- `forLog` (`backend/src/graphql/ErrorMapping.hpp`) can cut a UTF-8
  character at the cap, and doesn't redact Postgres `DETAIL` text,
  which can quote user input. (#107)

#### Done

- **Fix duplicate CORS header on preflight.** (#27) An OPTIONS request gets
  `Access-Control-Allow-Origin` twice: `CorsRequestInterceptor` adds the
  headers, then `CorsResponseInterceptor` adds them again
  (`backend/src/middleware/CorsMiddleware.hpp`). Browsers reject that, so
  a web app on a different origin from the API would fail every request.
  Local dev is unaffected (Vite proxies `/graphql`, same origin). Fix: skip
  OPTIONS in the response interceptor; add a test asserting one header.
- **Bring the shared KMP module up to date with the API.** (#28)
  - Map `errors[].extensions.code` (NOT_FOUND, CONFLICT, BAD_USER_INPUT,
    UNAVAILABLE, INTERNAL) to `ShepherdException` subtypes, like
    `web/src/errors.ts` does. Today everything is `Api(message)`.
  - Add `searchUsers` to the operations and repository.
  - Fetch `person { id name }` on `activePrayerBurdens` for the prayer list.
  - Add tests (the module has none).
- **Dev logs, watchable live on local.** (#30) Logs are split today: the API
  (`backend/src/middleware/RequestLogger.hpp`) goes to `docker compose logs
  api`, the web dev server to `$(WEB_LOG)` from `make start`, Postgres to
  its container. Add support for dev logs and a way to watch them as
  they're generated.
  - Add a `make logs` target that follows API, web and Postgres
    together, labelled by source.
  - Decide on log levels (DEBUG in dev, INFO otherwise) set by an env
    var, and whether to write to a file under the dev dir.

## 2026-10-20 — Contact clock restart; Prayer list; Review now screen

- **#61–#62 Review now screen** (web + mWeb) — two stacked PRs from the
  plan `~/.claude/plans/review-now-screen.md`, both open (not merged).
  Home's "Review now" button now goes to a new `/review` page instead
  of jumping to `#overdue`. Built from the canvas (`ReviewStep`,
  `ReviewLog`, `ReviewDone` and their mobile variants). No API changes.
  - **#61 Steps, log, skip** (base `main`) — the queue is
    `contactAlerts` filtered to overdue, in server order, frozen at
    first load so refetches after each save don't shift it. Each step:
    person card (meter via Home's `careDetails`, last note, newest
    active burden with "+N more", milestone tags) from `Person(id)`,
    and `LogContactForm` inline with "Log contact" / "Skip for now"
    (Skip sends nothing). New-contact variant adds the "What happens
    next" panel. Segmented progress bar, queue aside (web) / "Up next"
    (mWeb), focused header with Exit review, focus moves to each new
    step's h2. Minimal Finished screen. Shared changes:
    `LogContactForm`'s `onSaved` gets `{ withBurden }`, `Stepper` takes
    optional `outcomes`, `Meter` an optional `detail`.
  - **#62 Finished in full, Previous, stale people** (base
    `review-1-steps`) — Finished lists Logged today (detail lines and
    Undo via `deleteContact`) and Still overdue (Review again, then back
    to Finished). Undo moves the person to Still overdue as "Contact
    removed · …" if the refetch says they're overdue again; undoing a
    follow-up reverts the promotion on the server. Previous on a skipped
    step shows the form again; on a logged step, "Contact logged" with
    Next and Undo. A person who stops being overdue mid-review gets a
    note and Next and counts as neither logged nor skipped; a deleted or
    unassigned person is dropped from the queue silently. Ticks the
    Review now todo.
  - **Decisions** (user accepted all four recommendations): overdue
    only, no due soon (Q1); show the newest active burden from
    `Person(id)` (Q2); Undo on Finished (Q3); Previous on a logged step
    shows the logged state with Undo (Q4). The form keeps its own copy,
    not the canvas's. Session state lives in the page, so a reload
    starts over. Copy not on the canvas (empty state, stale notes,
    "Contact removed", "+N more") is flagged in each PR.
  - Not clicked through in a browser. Check `/review` locally after
    `make reset` (seed data with overdue people).
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

**State at end of day:** everything above except #61 and #62 is merged
to `main` (`080203c`, after the morning work log #60). #61 and #62 are
open: merge #61, then retarget #62 to `main`. This worktree is on
`work-log-2026-10-20-review`. From the PR descriptions (not re-run
here): pytest 298 and test-seed 18 on a fresh volume (#53), KMP 49
tests (#54), vitest 358 with `tsc`, eslint and `vite build` passing
(#61; #62 adds tests but doesn't give a total). Existing dev databases
need `make reset` for V007 and V008. Open: nobody has clicked through
the Prayer list or `/review` in a browser yet. New todos from the day:
collapse comments in Recently released by default, and rename "Longest
standing" to "Oldest". See [todo.md](todo.md) for next steps.

### Moved from the todo list

Completed items from `todo.md` whose PRs were opened this day (moved
2026-10-21).

#### Screens (web + mWeb/mobile)

- **My people** (#65, #66, #67): one page with a **Board / Gallery toggle**.
  - **Gallery**: full overview grid with search by name and status filter chips. 2-column cards on mWeb.
  - Decided 2026-10-16: milestone progress stays four fixed segments in this order for the demo: baptised, joined small group, serving, leading. Configurable milestones are a separate item below.
- **Person page** (web and mWeb), using Maria Santos as the example. (#71-#75)
  - Header card with a contact-status banner (on track / due / overdue) and a prominent "Log contact" button that opens the Log contact dialog. Replaces today's "Contacted today" link in the details card. (#40)
    - Progress bar against the 7-day or 72-hour goal. `Person.contactClockStart` (#47) now gives the start; the window is `contactDueAt - contactClockStart`, as Home's meter uses it (#48). (#71)
  - Milestones as a four-step journey (baptised, small group, serving, leading) showing when and any note; unrecorded steps get a "Record" button. (#73)
  - Prayer burdens: active burden with its comment thread (latest two shown, "Show earlier comments" for the rest), comment box and Release; released burdens in a collapsed list. (#74)
  - Notes: standalone notes with an add-note box (comments with no prayer burden). (#74)
  - Sidebar (web) or stacked sections (mWeb): details, shepherds (add / remove, "You" and co-shepherd labels), contact rule reminder, delete person. (#75)
  - Status change as a dropdown on the page, following the My people decision (New contact to Active opens the Log contact dialog; decided 2026-10-19). (#72)
  - Confirm each action that can't be undone (remove shepherd, remove yourself, delete person, remove milestone, delete comment) in a dialog before it happens. Release has an Undo toast instead of a confirmation (decided 2026-10-20). (#75)

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

### Moved from the todo list

Completed items from `todo.md` whose PRs were opened this day (moved
2026-10-21). Their Android and iOS follow-ups stay open in the todo list.

#### Screens (web + mWeb/mobile)

- **"Log contact" modal** (#39, #42) (to design, probably on the design canvas
  first). The one-tap buttons ("Contacted today" and "Log follow-up" on
  Home, "Contacted today" / "Followed up today" on the person card) open
  it instead of logging straight away. Fields: a date (defaults to the
  device's current date and time), a required note on what was talked
  about, and an optional prayer burden text field. Sends `logContact`
  with `contactedAt`, `note` and `prayerBurden`.
- **Add person page** (#41) at `/people/new`: name, age, year met and an optional first comment (status is always New contact), then a confirmation screen with the 72-hour follow-up deadline and "Log contact now". Replaces the inline form on My people.

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

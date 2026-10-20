# To Do

Check items off as they land; add the PR number when one exists.

## New business rule: contact cadence

Decided 2026-10-15. Drives the new home page (see the "Card & Gallery Views" design canvas, Home page).

- Every **active** member must be contacted at least once a week (7 days). If they have not been, raise an alert.
- A **new contact** must be followed up within 72 hours of contact. If not, raise an alert.
- Once a follow-up appointment has happened, the person becomes a **regular contact** (assumed: status moves from `new contact` to `active`, and the weekly rule applies from then on).
- Inactive and lost-contact people are not tracked by this rule.

- [x] Add the rule to the Business Rules list in `CLAUDE.md` (rule 6).
- [x] **Decide how "contact" and "follow-up" are recorded.** A `contact_log` table (who, when as `timestamptz`, follow-up flag, note) replaces `person.last_contact_date`. Migration `V003__contact_log.sql` backfills existing dates.
- [x] Backend: derive each person's contact state (overdue / due soon / on track / not tracked) and the date it is due. The `person_contact_state` view; GraphQL `contactState`, `contactDueAt`, `lastContactedAt`, `contacts`, `contactAlerts`, `logContact`, `deleteContact`. A follow-up promotes `new contact` to `active`.
- [x] Alerts: in-app first. Header bell with a count, and a "needs contacting" banner on My people until Home is built. Decide later whether to push or email.
- [x] Decided: a new contact with nothing logged has 72 hours from when they were added (`person.created_at`). Tom Becker is on track at first. **The Home design shows "Log first contact" as overdue; update it to match.**
- [x] Decided: a shared person alerts every shepherd, and any shepherd's contact clears it for all.
- [x] Decided 2026-10-16: undoing a follow-up also reverts the promotion. If that follow-up moved the person from `new contact` to `active` and their status hasn't changed since, Undo puts them back to `new contact`.
- [x] Build it. (server #37, web #42) Today Undo of a follow-up doesn't undo the promotion to `active`, and the web app only offers Undo on a plain contact. `delete_contact` needs to know the follow-up caused the promotion (e.g. a flag on the `contact_log` row); then offer Undo on follow-ups too.
- [ ] Existing dev databases need `make reset` to pick up V003 to V006 (migrations only run on a fresh volume).
- [ ] **Expose the clock start (or the window) from `person_contact_state`.** The UI only gets `contactDueAt`, so Home's meter still hard-codes `WINDOW` (7 days / 72 hours) in `web/src/pages/HomePage.tsx` to find where the clock started. Return the start (e.g. `contactClockStart`) so Home can drop `WINDOW` and the Person page can draw its progress bar (Screens, Person page).
- [x] **Log contact API, from the user story.** (#36) A shepherd adds a person (`createPerson` takes an optional `comment`), and adding them is the first contact. Logging a contact takes a required date and note and an optional prayer burden (`LogContactInput.prayerBurden`, linked by `prayer_burden.contact_log_id`, removed on Undo). Any contact for a `new contact` is their follow-up; `isFollowUp` is deprecated and ignored. Migration `V005__contact_burdens.sql`.

## Screens (web + mWeb/mobile)

The app needs both web and mobile-web layouts for every screen, then Android and iOS. Working through them as separate pages on the design canvas.

- [ ] **Review now** (mocked up for web and mWeb, pending build): opens from "Review now" on Home and steps through overdue people, most urgent first. Each step hosts `LogContactForm` inline (`web/src/pages/LogContactForm.tsx`, written for this) with "Log contact" and "Skip for now"; Skip logs nothing and leaves the person overdue. The Finished screen lists each contact logged in the session, each with Undo.
- [ ] **My people** (mocked up for web and mWeb, pending build): one page with a **Board / Gallery toggle**.
  - **Board** (default): columns for New contact, Active, Inactive, Lost contact. Each card shows name, last contact, milestone progress, prayer count and its contact-alert state.
    - [ ] Drag a card between columns to change status (updates `status` via `updatePerson`). On mobile, tabs per status plus a "Move to" menu instead of dragging.
    - [ ] Keyboard and screen-reader alternative to dragging: a "Move to" menu on every card.
    - [ ] Toast with Undo after a move.
    - [x] Decided 2026-10-16: what a status move means for the contact rule. Moving to Inactive or Lost contact stops alerts; moving back to Active or New contact restarts the clock from the move. (The New contact to Active part, "Did a follow-up happen?" with Yes / No, was replaced on 2026-10-19; see below.)
    - [x] Decided 2026-10-19: dragging New contact to Active opens the Log contact dialog instead of asking "Did they have a follow-up?" / "Move anyway". Since #36 any contact logged for a new contact is their follow-up and promotes them, so saving the dialog does the move; Cancel leaves the card where it was. There is no "move without a contact" path from New contact to Active. The design still just moves them; update it to open the dialog.
    - [ ] Build the clock-from-the-move part: `person_contact_state` needs to count from when the status last changed (e.g. a `person.status_changed_at`) when that is later than the last contact.
    - [ ] Persist the move optimistically and roll back if the mutation fails.
  - **Gallery**: full overview grid with search by name and status filter chips. 2-column cards on mWeb.
    - [ ] Remember the chosen view (board or gallery) per device, in `localStorage` (decided 2026-10-16).
    - [ ] Possible later: sort options (name, last contact, most overdue).
  - [x] Decided 2026-10-16: milestone progress stays four fixed segments in this order for the demo: baptised, joined small group, serving, leading. Configurable milestones are a separate item below.
- [ ] **Person page** (mocked up for web and mWeb, pending build), using Maria Santos as the example.
  - [x] Header card with a contact-status banner (on track / due / overdue) and a prominent "Log contact" button that opens the Log contact dialog. Replaces today's "Contacted today" link in the details card. (#40)
    - [ ] Progress bar against the 7-day or 72-hour goal. Left out because it needs the clock start from `person_contact_state`, not a hard-coded window.
  - [ ] Milestones as a four-step journey (baptised, small group, serving, leading) showing when and any note; unrecorded steps get a "Record" button.
  - [ ] Prayer burdens: active burden with its comment thread (latest two shown, "Show earlier comments" for the rest), comment box and Release; released burdens in a collapsed list.
  - [ ] Notes: standalone notes with an add-note box (comments with no prayer burden).
  - [ ] Sidebar (web) or stacked sections (mWeb): details, shepherds (add / remove, "You" and co-shepherd labels), contact rule reminder, delete person.
  - [ ] Status change as a dropdown on the page, following the My people decision (New contact to Active opens the Log contact dialog; decided 2026-10-19).
  - [ ] Confirm each destructive action (release, remove shepherd, delete person) before it happens. The mockup does not show the confirmations.
- [ ] **Prayer list** (mocked up for web and mWeb, pending build): all active burdens across the people you shepherd.
  - [ ] Sort: longest standing (default), newest, or grouped by person. Filter by person.
  - [ ] Each row: person, status, how long ago it was added, the burden, the latest comment, a Comment button with the count, and Release (with Undo).
  - [ ] Hide details switch that masks burden and comment text (for praying or scrolling in public). Remembered per device in `localStorage`, off by default (decided 2026-10-16).
  - [ ] Nudge on burdens that have been on the list for over a year ("Still the right one to carry?").
  - [ ] "Recently released" panel (answered or closed prayers, with the last comment) as encouragement. Needs a query for recently released burdens; today only `activePrayerBurdens` exists.
  - [ ] Add prayer burden: pick the person, then write it (the existing form lives on the person page).
  - [x] Decided 2026-10-16: no visibility setting between co-shepherds, even though burden text can be sensitive (one seed comment says "keep this quiet"). Every shepherd of a person sees all of their prayer burdens.
  - [ ] Make sure every user knows that all shepherds of a person see all of their prayer burdens (and comments), e.g. a line by the add-burden and comment boxes.
- [ ] **Sign in / register** (mocked up for web and mWeb, pending build): same fields and rules as today's `LoginPage` (name up to 100, username up to 50, password at least 8 on register).
  - [ ] One screen, no tabs: Sign in by default, with a "New here? Create an account" link below the button (and "Already have an account? Sign in" when registering). On web, a brand panel beside the form; on mWeb, a short brand header above it.
  - [ ] Inline field errors on submit (missing name, username or password; password under 8 characters), a wrong-credentials banner, and a Show / Hide password toggle.
  - [ ] Use the friendly error messages from `web/src/errors.ts` for the banner. Never say which of username or password was wrong.
  - [ ] Decide on later: password reset, "stay signed in", and how a new user lands on an empty Home (business rule 1: zero people).
  - [x] Checked 2026-10-16: the brand panel says only people you add as shepherds can see the people you care for. Reads are limited to a person's shepherds, but any co-shepherd can add more shepherds, so "people you add" isn't quite true. Decided: the copy says only a person's shepherds can see them.
- [ ] **Configurable milestones.** Let milestones be set up rather than fixed, and think through the other design decisions that come with it later. Until then, keep the four fixed milestones for the demo.
- [x] **"Log contact" modal** (#39, #42) (to design, probably on the design canvas
  first). The one-tap buttons ("Contacted today" and "Log follow-up" on
  Home, "Contacted today" / "Followed up today" on the person card) open
  it instead of logging straight away. Fields: a date (defaults to the
  device's current date and time), a required note on what was talked
  about, and an optional prayer burden text field. Sends `logContact`
  with `contactedAt`, `note` and `prayerBurden`.
  - [x] (#42) Until it's built, the buttons log a placeholder note
    (`QUICK_CONTACT_NOTE` in `web/src/contacts.ts`), since the API now
    requires one. Remove `quickContact` once the modal replaces it.
  - [ ] Android and iOS need the same modal.
- [x] **Add person page** (#41) at `/people/new`: name, age, year met and an optional first comment (status is always New contact), then a confirmation screen with the 72-hour follow-up deadline and "Log contact now". Replaces the inline form on My people.
  - [ ] Android and iOS need the same screen. The shared module's `createPerson` already takes `comment` (#43).
- [ ] **Dark mode for the `--sms-*` tokens.** `web/src/tokens.css` is light only, and the dark mode in `index.css` covers only the old palette, so the new screens (Home, Person, Add person, the Log contact dialog) stay light. Add dark values, then re-run the colour-contrast audit on the new screens in both themes (axe can't check contrast in jsdom, so do it in a browser).

## Design gaps (canvas vs API)

Found 2026-10-16 by checking the "Card & Gallery Views" canvas against
`schema.graphql`, the migrations and the resolvers. Undo of a follow-up
(contact cadence, above) and the recently-released query (Prayer list)
were already listed and aren't repeated here.

- [x] **Decide where contact notes show.** The Review "Log your contact"
  note goes to `contact_log.note`, but "Last note" (Home, Review) and the
  Person page Notes read `comment`. Either `logContact` also creates a
  standalone comment, or the screens merge contact notes into the feed.
  Decided 2026-10-16: it becomes a standalone comment linked to the
  contact (`comment.contact_log_id`, one per contact); undoing the contact
  deletes it. `contact_log.note` is gone; `ContactLog.note` reads the
  linked comment. Migration `V004__contact_notes.sql`.
- [x] **Per-person summaries on list queries.** (#35) `myPeople` and
  `contactAlerts` only run `rowToPerson`, so nested lists are empty
  (`operations.graphql` says never select them there). Home, My people
  and Review need, per person: milestone progress, active burden count,
  shepherds ("Shared with Grace Lin") and the latest note with its time.
  Done 2026-10-19 with summary fields: `recordedMilestoneIds` (not a
  count: milestones can be reached out of order), `activeBurdenCount`,
  `latestComment` (newest of any kind), and `shepherds` filled on list
  queries. The seed was brought in line with rules 5 and 6 in the same PR.
- [ ] **Undo a prayer-burden release.** The Prayer list toast offers Undo,
  but `release_prayer_burden` is one-way. Add an
  `unrelease_prayer_burden` function (new migration) and an
  `unreleasePrayerBurden(id)` mutation.
- [ ] **`PrayerBurden.comments` is never populated.** Nothing sets it, yet
  it's declared non-null. The Prayer list needs the count ("Comment (4)")
  and the latest comment with author and time; fill it in
  `activePrayerBurdens` (and wherever burdens are returned).
- [ ] **Person status on burdens.** `activePrayerBurdens` returns the
  person as `{id, name}` only; each Prayer list card shows a status pill.

## Brand

- [ ] **Logo: simple vector sheep in brand green** (`#3b6e4f` body, `#2d5a3f` head and legs). Used in every header and on the sign-in screen across all mockups. Turn it into a real SVG asset for web, then the favicon, Android launcher icon and iOS app icon.

## Next up

Ordered by priority (reordered 2026-10-16 after the design
gap check).

- [x] Click through the merged web app in a browser (`cd web && npm run
  dev`, http://localhost:3000). Tests pass on main, but nobody has clicked
  through the merged build yet.
- [x] Decide where contact notes show (Design gaps). Blocks the Home,
  Review and Person builds, so settle it before they start.
- [x] Per-person summaries on `myPeople` / `contactAlerts` (Design
  gaps). (#35) Every list screen in the canvas needs them.
- [ ] Finish the contact-cadence backend: the clock counts from a status
  move (`person.status_changed_at`), and expose the clock start. Needed
  by the My people board. (Undo of a follow-up reverting the promotion
  is done, #37.)
- [ ] Prayer list API in one pass: unrelease, `PrayerBurden.comments`,
  person status on burdens, recently released query (Design gaps and
  Prayer list).
- [ ] No rate limiting on `searchUsers` or login.
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
- [x] KMP: add `contactState` / `contactDueAt` / `lastContactedAt`, `contactAlerts`, `logContact` and `deleteContact` to the shared module, and stop using `lastContactDate` there. (#43)
- [ ] Drop the deprecated `lastContactDate` (on `Person` and `UpdatePersonInput`) from the API. Since #43 only `tests/test_api.py` uses it.
- [x] Assumption to confirm: "active" means status `active`, not the separate `is_active` flag (they can disagree; nothing keeps them in sync). Confirmed 2026-10-16.
- [x] Assumption to confirm: "due soon" is the last 48 hours before the weekly deadline and the last 24 hours before the 72-hour one. Confirmed 2026-10-16.
- [x] `backend/src/main.cpp` falls back to `0.0.0.0` / `8080` when
  `API_HOST` / `API_PORT` are unset, against the no-defaults rule.
  Validate them in `AppComponent::validateEnv()` with the rest. (#31)
- [x] **Home** (based on option B, care-first): people who need contacting, up top. Web and mWeb mocked up. (#32)

## Mobile apps

- [ ] **Android screens** (Jetpack Compose): sign in / register, people list
  with add person, person page (details, milestones, prayer burdens,
  comments, shepherds), prayer list. `MainActivity.kt` is still a shell.
- [ ] **iOS screens** (SwiftUI): same screens; `ContentView.swift` is still a
  placeholder.

## Backend follow-ups (low priority)

- [ ] `update_person` can't clear a value once set (COALESCE treats null as
  "leave unchanged"), e.g. age or last contact date. Needs an explicit
  "clear" signal.
- [ ] "Can't remove the last shepherd" is enforced only in the resolver,
  not in the database.
- [ ] `searchUsers` returns the full `User` type, so `createdAt`/`updatedAt`
  are visible to any signed-in user. A slimmer `UserSummary { id name
  username }` would hide them.
- [ ] `assignPerson`'s "User not found" lets a caller probe whether a user
  id exists (low).
- [ ] `PrayerBurden.person` is filled only by `activePrayerBurdens`; other
  queries return it null.
- [ ] **Logging follow-ups from #30.**
  - [ ] Client address always logs as "unknown": `peer_address` isn't
    populated on the connection in `RequestLogger.hpp`.
  - [ ] `validateEnv()` runs once per component in `AppComponent.hpp`;
    parse the env once.
  - [ ] `forLog` (`backend/src/graphql/ErrorMapping.hpp`) can cut a UTF-8
    character at the cap, and doesn't redact Postgres `DETAIL` text,
    which can quote user input.

## Housekeeping

- [ ] Remove old worktrees and branches under `.claude/worktrees/`
  (auth-middleware, claude-rules-setup, docker-config, implement-security,
  multi-agent-setup). Leave `design-notes` alone: it is locked, probably by
  an active session.
- [ ] **Vite dev proxy ignores `API_PORT`.** `web/vite.config.ts` proxies
  `/graphql` to a hardcoded `http://localhost:8080`, so changing `API_PORT`
  in `.env` breaks the web app in dev. Read `API_PORT` from `.env` (no
  fallback) the way the Makefile does.
- [ ] Regenerate `docs/diagrams/schema.svg` from `schema.mmd`. The PNG
  shows `comment.contact_log_id` (V004); the SVG doesn't yet.

## Done

- [x] **Fix duplicate CORS header on preflight.** (#27) An OPTIONS request gets
  `Access-Control-Allow-Origin` twice: `CorsRequestInterceptor` adds the
  headers, then `CorsResponseInterceptor` adds them again
  (`backend/src/middleware/CorsMiddleware.hpp`). Browsers reject that, so
  a web app on a different origin from the API would fail every request.
  Local dev is unaffected (Vite proxies `/graphql`, same origin). Fix: skip
  OPTIONS in the response interceptor; add a test asserting one header.
- [x] **Bring the shared KMP module up to date with the API.** (#28)
  - Map `errors[].extensions.code` (NOT_FOUND, CONFLICT, BAD_USER_INPUT,
    UNAVAILABLE, INTERNAL) to `ShepherdException` subtypes, like
    `web/src/errors.ts` does. Today everything is `Api(message)`.
  - Add `searchUsers` to the operations and repository.
  - Fetch `person { id name }` on `activePrayerBurdens` for the prayer list.
  - Add tests (the module has none).
- [x] **Dev logs, watchable live on local.** (#30) Logs are split today: the API
  (`backend/src/middleware/RequestLogger.hpp`) goes to `docker compose logs
  api`, the web dev server to `$(WEB_LOG)` from `make start`, Postgres to
  its container. Add support for dev logs and a way to watch them as
  they're generated.
  - [x] Add a `make logs` target that follows API, web and Postgres
    together, labelled by source.
  - [x] Decide on log levels (DEBUG in dev, INFO otherwise) set by an env
    var, and whether to write to a file under the dev dir.

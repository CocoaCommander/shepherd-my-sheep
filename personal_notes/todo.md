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
- [ ] Assumption to confirm: "active" means status `active`, not the separate `is_active` flag (they can disagree; nothing keeps them in sync).
- [ ] Assumption to confirm: "due soon" is the last 48 hours before the weekly deadline and the last 24 hours before the 72-hour one.
- [ ] Undo of a follow-up doesn't undo the promotion to `active`; the web app only offers Undo on a plain contact.
- [ ] KMP: add `contactState` / `contactDueAt` / `lastContactedAt`, `contactAlerts` and `logContact` to the shared module, then drop the deprecated `lastContactDate` (on `Person` and `UpdatePersonInput`) from the API.
- [ ] Existing dev databases need `make reset` to pick up V003 (migrations only run on a fresh volume).

## Screens (web + mWeb/mobile)

The app needs both web and mobile-web layouts for every screen, then Android and iOS. Working through them as separate pages on the design canvas.

- [ ] **Home** (based on option B, care-first): people who need contacting, up top. Web and mWeb mocked up.
- [ ] **Review now** (mocked up for web and mWeb, pending build): opens from "Review now" on Home and steps through overdue people, most urgent first. "Contacted today" logs a time, not just a date, so the 72-hour rule can be measured; Skip logs nothing and leaves the person overdue. Has a new-contact log step and a finished screen.
- [ ] **My people** (mocked up for web and mWeb, pending build): one page with a **Board / Gallery toggle**.
  - **Board** (default): columns for New contact, Active, Inactive, Lost contact. Each card shows name, last contact, milestone progress, prayer count and its contact-alert state.
    - [ ] Drag a card between columns to change status (updates `status` via `updatePerson`). On mobile, tabs per status plus a "Move to" menu instead of dragging.
    - [ ] Keyboard and screen-reader alternative to dragging: a "Move to" menu on every card.
    - [ ] Toast with Undo after a move.
    - [ ] Decide what moving to or from a status means for the contact rule. Moving to Inactive or Lost contact stops alerts; moving New contact to Active should probably ask whether a follow-up happened (the design just moves them).
    - [ ] Persist the move optimistically and roll back if the mutation fails.
  - **Gallery**: full overview grid with search by name and status filter chips. 2-column cards on mWeb.
    - [ ] Remember the chosen view (board or gallery) per user or device.
    - [ ] Possible later: sort options (name, last contact, most overdue).
  - [ ] Milestone progress is four segments: baptised, joined small group, serving, leading. Confirm this fixed order is right if milestones become configurable.
- [ ] **Person page** (mocked up for web and mWeb, pending build), using Maria Santos as the example.
  - [ ] Header card with a contact-status banner (on track / due / overdue, with a progress bar against the 7-day or 72-hour goal) and a prominent "Contacted today" button. Replaces today's "Contacted today" link in the details card.
  - [ ] Milestones as a four-step journey (baptised, small group, serving, leading) showing when and any note; unrecorded steps get a "Record" button.
  - [ ] Prayer burdens: active burden with its comment thread (latest two shown, "Show earlier comments" for the rest), comment box and Release; released burdens in a collapsed list.
  - [ ] Notes: standalone notes with an add-note box (comments with no prayer burden).
  - [ ] Sidebar (web) or stacked sections (mWeb): details, shepherds (add / remove, "You" and co-shepherd labels), contact rule reminder, delete person.
  - [ ] Status change as a dropdown on the page (same open question as My people about what it means for the contact rule).
  - [ ] Confirm each destructive action (release, remove shepherd, delete person) before it happens. The mockup does not show the confirmations.
- [ ] **Prayer list** (mocked up for web and mWeb, pending build): all active burdens across the people you shepherd.
  - [ ] Sort: longest standing (default), newest, or grouped by person. Filter by person.
  - [ ] Each row: person, status, how long ago it was added, the burden, the latest comment, a Comment button with the count, and Release (with Undo).
  - [ ] Hide details switch that masks burden and comment text (for praying or scrolling in public). Decide whether it should be remembered per device.
  - [ ] Nudge on burdens that have been on the list for over a year ("Still the right one to carry?").
  - [ ] "Recently released" panel (answered or closed prayers, with the last comment) as encouragement. Needs a query for recently released burdens; today only `activePrayerBurdens` exists.
  - [ ] Add prayer burden: pick the person, then write it (the existing form lives on the person page).
  - [ ] Burden text can be sensitive (one seed comment says "keep this quiet"). Decide whether burdens need a visibility setting between co-shepherds.
- [ ] **Sign in / register** (mocked up for web and mWeb, pending build): same fields and rules as today's `LoginPage` (name up to 100, username up to 50, password at least 8 on register).
  - [ ] One screen, no tabs: Sign in by default, with a "New here? Create an account" link below the button (and "Already have an account? Sign in" when registering). On web, a brand panel beside the form; on mWeb, a short brand header above it.
  - [ ] Inline field errors on submit (missing name, username or password; password under 8 characters), a wrong-credentials banner, and a Show / Hide password toggle.
  - [ ] Use the friendly error messages from `web/src/errors.ts` for the banner. Never say which of username or password was wrong.
  - [ ] Decide on later: password reset, "stay signed in", and how a new user lands on an empty Home (business rule 1: zero people).
  - [ ] The brand panel says only people you add as shepherds can see the people you care for. Make sure that is true before shipping the copy.

## Brand

- [ ] **Logo: simple vector sheep in brand green** (`#3b6e4f` body, `#2d5a3f` head and legs). Used in every header and on the sign-in screen across all mockups. Turn it into a real SVG asset for web, then the favicon, Android launcher icon and iOS app icon.

## Next up

- [ ] **Fix duplicate CORS header on preflight.** An OPTIONS request gets
  `Access-Control-Allow-Origin` twice: `CorsRequestInterceptor` adds the
  headers, then `CorsResponseInterceptor` adds them again
  (`backend/src/middleware/CorsMiddleware.hpp`). Browsers reject that, so
  a web app on a different origin from the API would fail every request.
  Local dev is unaffected (Vite proxies `/graphql`, same origin). Fix: skip
  OPTIONS in the response interceptor; add a test asserting one header.
- [ ] **Bring the shared KMP module up to date with the API.**
  - Map `errors[].extensions.code` (NOT_FOUND, CONFLICT, BAD_USER_INPUT,
    UNAVAILABLE, INTERNAL) to `ShepherdException` subtypes, like
    `web/src/errors.ts` does. Today everything is `Api(message)`.
  - Add `searchUsers` to the operations and repository.
  - Fetch `person { id name }` on `activePrayerBurdens` for the prayer list.
  - Add tests (the module has none).

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
- [ ] No rate limiting on `searchUsers` or login.
- [ ] `assignPerson`'s "User not found" lets a caller probe whether a user
  id exists (low).
- [ ] `PrayerBurden.person` is filled only by `activePrayerBurdens`; other
  queries return it null.

## Housekeeping

- [ ] Click through the merged web app in a browser (`cd web && npm run
  dev`, http://localhost:3000). Tests pass on main, but nobody has clicked
  through the merged build yet.
- [ ] Remove old worktrees and branches under `.claude/worktrees/`
  (auth-middleware, claude-rules-setup, docker-config, implement-security,
  multi-agent-setup). Leave `design-notes` alone: it is locked, probably by
  an active session.

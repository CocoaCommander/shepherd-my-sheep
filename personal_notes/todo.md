# To Do

Check items off as they land; add the PR number when one exists.

## New business rule: contact cadence

Decided 2026-10-15. Drives the new home page (see the "Card & Gallery Views" design canvas, Home page).

- Every **active** member must be contacted at least once a week (7 days). If they have not been, raise an alert.
- A **new contact** must be followed up within 72 hours of contact. If not, raise an alert.
- Once a follow-up appointment has happened, the person becomes a **regular contact** (assumed: status moves from `new contact` to `active`, and the weekly rule applies from then on).
- Inactive and lost-contact people are not tracked by this rule.

- [ ] Existing dev databases need `make reset` to pick up V003 to V008 (migrations only run on a fresh volume).

## Screens (web + mWeb/mobile)

The app needs both web and mobile-web layouts for every screen, then Android and iOS. Working through them as separate pages on the design canvas.

- [x] **My people** (#65, #66, #67): one page with a **Board / Gallery toggle**.
  - **Gallery**: full overview grid with search by name and status filter chips. 2-column cards on mWeb.
    - [ ] Possible later: sort options (name, last contact, most overdue).
  - [x] Decided 2026-10-16: milestone progress stays four fixed segments in this order for the demo: baptised, joined small group, serving, leading. Configurable milestones are a separate item below.
- [x] **Person page** (web and mWeb), using Maria Santos as the example. (#71-#75)
  - [x] Header card with a contact-status banner (on track / due / overdue) and a prominent "Log contact" button that opens the Log contact dialog. Replaces today's "Contacted today" link in the details card. (#40)
    - [x] Progress bar against the 7-day or 72-hour goal. `Person.contactClockStart` (#47) now gives the start; the window is `contactDueAt - contactClockStart`, as Home's meter uses it (#48). (#71)
  - [x] Milestones as a four-step journey (baptised, small group, serving, leading) showing when and any note; unrecorded steps get a "Record" button. (#73)
  - [x] Prayer burdens: active burden with its comment thread (latest two shown, "Show earlier comments" for the rest), comment box and Release; released burdens in a collapsed list. (#74)
  - [x] Notes: standalone notes with an add-note box (comments with no prayer burden). (#74)
  - [x] Sidebar (web) or stacked sections (mWeb): details, shepherds (add / remove, "You" and co-shepherd labels), contact rule reminder, delete person. (#75)
  - [x] Status change as a dropdown on the page, following the My people decision (New contact to Active opens the Log contact dialog; decided 2026-10-19). (#72)
  - [x] Confirm each action that can't be undone (remove shepherd, remove yourself, delete person, remove milestone, delete comment) in a dialog before it happens. Release has an Undo toast instead of a confirmation (decided 2026-10-20). (#75)
- [ ] **Sign in / register** (mocked up for web and mWeb, pending build): same fields and rules as today's `LoginPage` (name up to 100, username up to 50, password at least 8 on register).
  - [x] One screen, no tabs: Sign in by default, with a "New here? Create an account" link below the button (and "Already have an account? Sign in" when registering). On web, a brand panel beside the form; on mWeb, a short brand header above it. (#89)
  - [x] Inline field errors on submit (missing name, username or password; password under 8 characters), a wrong-credentials banner, and a Show / Hide password toggle. (#89)
  - [x] Use the friendly error messages from `web/src/errors.ts` for the banner. Never say which of username or password was wrong. (#89)
  - [ ] Decide on later: password reset, "stay signed in", and how a new user lands on an empty Home (business rule 1: zero people).
  - [ ] Build on the design system, not the old globals. `LoginPage` still uses `auth`, `card`, `stack`, `error` and the bare `input` / `button` / `label` rules from `web/src/index.css`, so in dark mode its text takes the old `--text` (#e8e6e3) from `body`. The Person page had the same bug (640px cap, light text on white cards; fixed in #78). Give the page its own wrapper like Home's (`.page` / `.main` with `--sms-bg` and `--sms-ink`) and use `TextField` / `PasswordField` / `Button` / `Alert`. Once it no longer uses them, delete the leftover globals and the old colour variables from `index.css`.
- [ ] **Configurable milestones.** Let milestones be set up rather than fixed, and think through the other design decisions that come with it later. Until then, keep the four fixed milestones for the demo.
- [x] **"Log contact" modal** (#39, #42) (to design, probably on the design canvas
  first). The one-tap buttons ("Contacted today" and "Log follow-up" on
  Home, "Contacted today" / "Followed up today" on the person card) open
  it instead of logging straight away. Fields: a date (defaults to the
  device's current date and time), a required note on what was talked
  about, and an optional prayer burden text field. Sends `logContact`
  with `contactedAt`, `note` and `prayerBurden`.
  - [ ] Android and iOS need the same modal.
- [x] **Add person page** (#41) at `/people/new`: name, age, year met and an optional first comment (status is always New contact), then a confirmation screen with the 72-hour follow-up deadline and "Log contact now". Replaces the inline form on My people.
  - [ ] Android and iOS need the same screen. The shared module's `createPerson` already takes `comment` (#43).
- [ ] **Dark mode for the `--sms-*` tokens.** `web/src/tokens.css` is light only, and the dark mode in `index.css` covers only the old palette, so the new screens (Home, Person, Add person, the Log contact dialog) stay light. Add dark values, then re-run the colour-contrast audit on the new screens in both themes (axe can't check contrast in jsdom, so do it in a browser).

## Brand

- [ ] **Logo: simple vector sheep in brand green** (`#3b6e4f` body, `#2d5a3f` head and legs). Used in every header and on the sign-in screen across all mockups. Turn it into a real SVG asset for web, then the favicon, Android launcher icon and iOS app icon.

## Next up

Ordered by priority (reordered 2026-10-16 after the design
gap check).

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
- [ ] Drop the deprecated `lastContactDate` (on `Person` and `UpdatePersonInput`) from the API. Since #43 only `tests/test_api.py` uses it.

## Mobile apps

- [ ] **Android screens** (Jetpack Compose): sign in / register, people list
  with add person, person page (details, milestones, prayer burdens,
  comments, shepherds), prayer list. `MainActivity.kt` is still a shell.
- [ ] **iOS screens** (SwiftUI): same screens; `ContentView.swift` is still a
  placeholder.
- [ ] KMP shared module: add `Person.statusChangedAt` and the
  `undoStatusChange` mutation (#65) when the mobile My people
  board needs Undo after a move.

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
- [ ] `PrayerBurden.person` is filled (id, name, status only) by every
  root burden field (#52); still unset under `Person.prayerBurdens` and
  inside a `Comment`.
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

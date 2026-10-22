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

- [ ] **My people gallery: sort options** (possible later): name, last contact, most overdue. The gallery itself is done (#67).
- [ ] **Sign in / register** (mocked up for web and mWeb, pending build): same fields and rules as today's `LoginPage` (name up to 100, username up to 50, password at least 8 on register).
  - [ ] Decide on later: password reset, "stay signed in", and how a new user lands on an empty Home (business rule 1: zero people).
- [ ] **Configurable milestones.** Let milestones be set up rather than fixed, and think through the other design decisions that come with it later. Until then, keep the four fixed milestones for the demo.
- [ ] **"Log contact" modal on Android and iOS.** The web one is done (#39, #42); Android and iOS need the same modal.
- [ ] **Add person page on Android and iOS.** The web one is done (#41); Android and iOS need the same screen. The shared module's `createPerson` already takes `comment` (#43).
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

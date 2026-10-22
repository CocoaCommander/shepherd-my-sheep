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

Ordered by priority (reordered 2026-10-21 once the list had emptied).
Each item is a copy of one in its own section, named after the dash; tick
both. User-facing bugs and data exposure first, then the web polish, then
the small backend clean-ups, then the mobile apps. Left out on purpose:
"possible later" / "decide on later" items, configurable milestones (needs
design decisions first), and the `make reset` note.

- [ ] **Dark mode for the `--sms-*` tokens.** — *Screens*
- [ ] **Logo: simple vector sheep in brand green.** Web SVG and
  favicon first; the Android and iOS icons can wait for the apps.
  — *Brand*
- [ ] `PrayerBurden.person` is filled (id, name, status only) by every
  root burden field (#52); still unset under `Person.prayerBurdens` and
  inside a `Comment`. — *Backend follow-ups*
- [ ] `validateEnv()` runs once per component in `AppComponent.hpp`;
  parse the env once. — *Backend follow-ups, Logging follow-ups from
  #30*
- [ ] `assignPerson`'s "User not found" lets a caller probe whether a
  user id exists (low). — *Backend follow-ups*
- [ ] Remove old worktrees and branches under `.claude/worktrees/`.
  The worktrees are already gone (checked 2026-10-21); the branches
  `auth-middleware` (local and origin), `docker-config`,
  `implement-security` and `worktree-multi-agent-setup` (origin)
  remain. — *Housekeeping*
- [ ] **Android screens** (Jetpack Compose), with the "Log contact"
  modal, the Add person page and the KMP `statusChangedAt` /
  `undoStatusChange` item along the way. — *Mobile apps, Screens*
- [ ] **iOS screens** (SwiftUI), with the same modal and Add person
  page. — *Mobile apps, Screens*

## Mobile apps

- [ ] **Android screens** (Jetpack Compose): sign in / register, people list
  with add person, person page (details, milestones, prayer burdens,
  comments, shepherds), prayer list. `MainActivity.kt` is still a shell.
- [ ] **iOS screens** (SwiftUI): same screens; `ContentView.swift` is still a
  placeholder.
- [ ] KMP shared module: add `Person.statusChangedAt` and the
  `undoStatusChange` mutation (#65) when the mobile My people
  board needs Undo after a move.
- [ ] KMP `updatePerson` can't clear age / year met: it sends
  `Optional.presentIfNotNull`, so null means unchanged. When the mobile
  edit screen needs it, send `Optional.present(null)` to clear (#103).

## Backend follow-ups (low priority)

- [ ] `assignPerson`'s "User not found" lets a caller probe whether a user
  id exists (low).
- [ ] `PrayerBurden.person` is filled (id, name, status only) by every
  root burden field (#52); still unset under `Person.prayerBurdens` and
  inside a `Comment`.
- [ ] `Person.shepherds`, `Comment.author`, `ContactLog.contactedBy`,
  `PrayerLog.prayedBy` and `MilestonePerson.recordedBy` still return the
  full `User`, so co-shepherds get each other's `createdAt`/`updatedAt`
  (the executor sends every DTO field, whatever is selected). Switch them
  to `UserSummary` (#111); the KMP `UserFields` fragment and `User` model
  for those fields go with it.
- [ ] **Logging follow-ups from #30.**
  - [ ] `validateEnv()` runs once per component in `AppComponent.hpp`;
    parse the env once.

## Housekeeping

- [ ] Remove old worktrees and branches under `.claude/worktrees/`
  (auth-middleware, claude-rules-setup, docker-config, implement-security,
  multi-agent-setup). Leave `design-notes` alone: it is locked, probably by
  an active session.

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
- [ ] **Configurable milestones.** Let milestones be set up rather than
  fixed: one shared list that any signed-in user can add to, rename and
  delete, on an "Edit milestones" page (mocked up for web and mWeb on the
  "Milestones" design canvas, page "Edit milestones"). Plan:
  `~/.claude/plans/configurable-milestones.md` (backend and web built in
  parallel against an API contract; backend merges first).
  - No order: milestones can be reached in any order, so every list is A
    to Z. The person page drops the fixed four-step journey and shows
    every milestone.
  - Names are trimmed, up to 100 characters, unique ignoring case.
    Descriptions are optional.
  - Delete warns how many people have it recorded ("Their dates and notes
    for this milestone will be deleted too") and offers Undo. In the DB it
    is a soft delete (`milestone.deleted_at`), restorable for an hour.
  - The list may be empty; every milestone screen must work with none
    (extends business rule 2).
  - Until it lands, keep the four fixed milestones for the demo.
- [ ] **"Log contact" modal on Android and iOS.** The web one is done (#39, #42); Android and iOS need the same modal.
- [ ] **Add person page on Android and iOS.** The web one is done (#41); Android and iOS need the same screen. The shared module's `createPerson` already takes `comment` (#43).
- [ ] **Group people by milestone.** See everyone who has completed a
  given milestone, from the `Milestone` and `MilestonePerson` types.
  Mocked up as "Milestones view" on the "Milestones" design canvas. It
  builds on configurable milestones; see that plan's "Later: Milestones
  view" for the API it needs (dates per recorded milestone on `myPeople`).
- [ ] **Attendance feature.** No design or code yet; it needs a screen on
  the design canvas first.

## Brand

- [ ] **Logo: simple vector sheep in brand green** (`#3b6e4f` body, `#2d5a3f` head and legs). Used in every header and on the sign-in screen across all mockups. Turn it into a real SVG asset for web, then the favicon, Android launcher icon and iOS app icon.
  - [ ] Android launcher icon (Option A, `t-green` tile; the canvas has a round-mask preview).
  - [ ] iOS app icon (Option A, `t-green`, full square).

## Next up

Ordered by priority (reordered 2026-10-21 once the list had emptied).
Each item is a copy of one in its own section, named after the dash; tick
both. User-facing bugs and data exposure first, then the web polish, then
the small backend clean-ups, then the mobile apps. Left out on purpose:
"possible later" / "decide on later" items and the `make reset` note.
Configurable milestones now has a design and a plan (2026-11-16) but
hasn't been ranked here yet.

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
- [ ] KMP shared module: configurable milestones. Add `recordedCount`,
  `createdAt` and `updatedAt` to `Milestone`, and the `createMilestone` /
  `updateMilestone` / `deleteMilestone` / `restoreMilestone` mutations, when
  the mobile apps get an Edit milestones screen. Until then the existing
  `Milestones` query keeps working; drop any hard-coded four.

## Backend follow-ups (low priority)

- [ ] `assignPerson`'s "User not found" lets a caller probe whether a user
  id exists (low).
- [ ] **Composite FK so a comment's burden must match its person.**
  The security review noted that only the API checks a comment's burden
  belongs to the same person; the database doesn't enforce it. Add a
  composite FK on `comment` `(prayer_burden_id, person_id)` referencing
  `prayer_burden (id, person_id)`, which needs a unique constraint on
  `prayer_burden (id, person_id)`. Schema is in
  `db/migrations/V001__initial_schema.sql` (new migration needed).
  Use `ON DELETE SET NULL (prayer_burden_id)`: a plain `SET NULL` would
  also null the `NOT NULL` `person_id`, so deleting a burden would fail
  instead of unlinking its comments.

## Housekeeping

- [ ] Remove old worktrees and branches under `.claude/worktrees/`
  (auth-middleware, claude-rules-setup, docker-config, implement-security,
  multi-agent-setup). Leave `design-notes` alone: it is locked, probably by
  an active session.
- [ ] **Fix the `punycode` deprecation warning** (`DEP0040`: "The
  `punycode` module is deprecated"), printed by a Node tool on 22.12.
  Find the caller with `NODE_OPTIONS=--trace-deprecation`. Candidates:
  root `eslint` → `ajv@6` → `uri-js`, and `web/` `jsdom` →
  `whatwg-url` → `tr46`. Fix it by upgrading or replacing the
  dependency, not by silencing the warning (`--no-deprecation`).

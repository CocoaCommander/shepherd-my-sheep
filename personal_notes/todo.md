# To Do

Check items off as they land; add the PR number when one exists.

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
  multi-agent-setup — that one is locked).

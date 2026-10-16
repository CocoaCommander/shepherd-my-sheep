# Shepherd My Sheep

## Tech Stack
- **Database**: PostgreSQL 16
- **Backend**: C++ (oatpp framework, libpqxx)
- **API**: GraphQL
- **Frontend (Web)**: React / TypeScript
- **Frontend (Android)**: Kotlin Multiplatform (shared logic) + Jetpack Compose (UI)
- **Frontend (iOS)**: Kotlin Multiplatform (shared logic) + SwiftUI (UI)

## Business Rules

These rules must be followed across the entire codebase:

1. **A user may have zero people** — a freshly created user has no one assigned to them. People lists must always be valid when empty.
2. **A person may have zero milestones** — e.g. someone we've just met. Never assume milestones exist.
3. **A person may have zero prayer burdens** — prayer burdens are added over time, not required.
4. **A prayer burden may have zero comments** — prayer burdens can be assigned directly to a person without any comment. Comments are optional discussion on a burden.
5. **A comment may or may not link to a prayer burden** — comments can be standalone notes on a person, or linked to a specific prayer burden.
6. **Contact cadence** — every `active` person must be contacted at least every 7 days; a `new contact` must be followed up within 72 hours (counted from when they were added if no contact is logged yet). Logging a follow-up moves a `new contact` to `active`. `inactive` and `lost contact` people are not tracked. A person's contact state (overdue / due soon / on track / not tracked) belongs to the person, so every shepherd sees the alert and any shepherd's contact clears it. The rule lives in the `person_contact_state` view; contacts are logged in `contact_log`, and a person may have none.

## Environment Variables

All secrets and connection parameters come from `.env` (gitignored). Never hardcode credentials.

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — database connection
- `API_HOST`, `API_PORT` — server bind address (parameterized for deployment)
- `CORS_ORIGIN` — allowed origin for browser requests (e.g. `http://localhost:3000`). If unset, no origin is allowed (safe default).
- `JWT_SECRET` — HS256 signing key. Minimum 32 bytes; generate with `openssl rand -base64 48`.
- `JWT_ISSUER` — `iss` claim, and the value tokens are verified against (e.g. `shepherd-my-sheep`)
- `JWT_ACCESS_TTL` — access token lifetime in seconds (e.g. `3600`)
- `LOG_LEVEL` — `DEBUG`, `INFO`, `WARN` or `ERROR`. Required, no default: the API exits at startup if it is missing or invalid. `DEBUG` for local dev (also logs each incoming request), `INFO` otherwise.

**CRITICAL: No credential defaults anywhere.** Actual usernames, passwords, and database names must never appear as fallback/default values in source code, test fixtures, config files, or anywhere outside of `.env`. All code must read from environment variables and fail if they are missing.

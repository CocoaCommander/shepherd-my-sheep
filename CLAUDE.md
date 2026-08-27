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

## Environment Variables

All secrets and connection parameters come from `.env` (gitignored). Never hardcode credentials.

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — database connection
- `API_HOST`, `API_PORT` — server bind address (parameterized for deployment)

**CRITICAL: No credential defaults anywhere.** Actual usernames, passwords, and database names must never appear as fallback/default values in source code, test fixtures, config files, or anywhere outside of `.env`. All code must read from environment variables and fail if they are missing.

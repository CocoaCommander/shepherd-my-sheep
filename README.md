# shepherd-my-sheep
A full stack app to track progression of the ones we are caring for

## Running locally

Needs Docker running and a filled-in `.env` (see `CLAUDE.md`).

```sh
make deps      # one-time: Python packages for the seed script and tests
make start     # Postgres, the API (rebuilt) and the web dev server
make stop      # stop all three; the database is kept
make restart   # stop, then start; picks up backend and web changes
make reset     # wipe the database, start fresh and load demo data
make help      # list every target
```

The web app is at http://localhost:3000. The dev server runs in the background and logs to `.dev/web.log`.

## Sample data

`db/seed` holds a hand-written demo dataset: three users (one with nobody assigned yet) and 15 people with milestones, prayer burdens and comments, covering every business rule in `CLAUDE.md`. It is opt-in and never part of the migrations.

```sh
make seed      # starts the db and loads demo data; needs SEED_USER_PASSWORD in .env
make reseed    # wipe and reload
```

Then log in as `demo_shepherd`, `demo_coleader` or `demo_newuser` with `SEED_USER_PASSWORD`. Tests get the same data through the `seeded_db` fixture, inside their rollback. `make test` runs the suite with `.env` loaded (`make test-seed` for just the seed tests).

## Linting

Every language has a linter or formatter, run through [pre-commit](https://pre-commit.com):

| Area | Tools |
|---|---|
| C++ | clang-format; clang-tidy (`docker build --target lint backend`) |
| Web / GraphQL | ESLint (with graphql-eslint checking operations against the schema), Prettier |
| Kotlin | ktlint, detekt with Compose rules (`gradle detekt`) |
| SQL migrations | SQLFluff, squawk |
| Python tests | Ruff |
| Dockerfile / Swift | hadolint, SwiftLint (pinned Docker images) |
| Secrets | gitleaks; a hook and CI job that reject committed `.env` files |

One-time setup (needs Docker running):

```sh
npm ci
pre-commit install
```

Run everything with `pre-commit run --all-files`. CI runs the same hooks, plus a full-history gitleaks scan and clang-tidy.

Web component tests (vitest + Testing Library): `cd web && npm test`.

Applied migrations (`V001`, `V002`) are excluded from SQL formatting, because changing them breaks migration checksums. Add each new migration to `.sqlfluffignore` and the `exclude` pattern in `.pre-commit-config.yaml` once it has been applied anywhere shared.

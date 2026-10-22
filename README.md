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
make logs      # follow API, Postgres and web logs together; Ctrl-C stops
make help      # list every target
```

The web app is at http://localhost:3000. The dev server runs in the background and logs to `.dev/web.log`.

The API logs to stdout only (`[YYYY-MM-DD HH:MM:SS] LEVEL message`), at the threshold set by `LOG_LEVEL`; Docker keeps it and `make logs` shows it. It writes no log file of its own.

If you already have a `.env`, add `LOG_LEVEL` and `AUTH_RATE_LIMIT_PER_MINUTE` (see `.env.example`); the API will not start without them. For local dev set `AUTH_RATE_LIMIT_PER_MINUTE` high (e.g. `1000`): `make test` registers a few hundred users from one address.

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

## PR screenshots

Every PR has a **Before / After** section: screenshots when the web UI changes, two short lines of text when it doesn't. For the screenshots, run this from the feature branch, with `make start` and `make seed` done:

```sh
web/scripts/pr-screenshots.sh --base main --user demo_shepherd --dark --publish /people "person:Marcus Reid"
```

It starts a dev server for the base branch and one for yours, each on a free port, and shoots each page at 1280 and 390 wide (light, plus dark with `--dark`). With `--publish` it commits the images to the `pr-assets` branch and prints a Before | After Markdown table for the PR body. `pr-assets` holds only images and shares no history with `main`. Only demo data appears. `web/scripts/screenshots.mjs` takes the screenshots and can be run on its own against any running dev server. Page targets are a path (`/people`), `person:<name>`, `signed-out:<path>` (shot without the stored token, e.g. `signed-out:/login`) and `register` (the signed-out sign in page after switching to Create an account). The first run needs `npx playwright install --only-shell chromium` in `web/`.

## Contrast audit

axe can't measure colour contrast in jsdom, so `web/scripts/contrast-audit.mjs` runs axe's `color-contrast` rule in Chromium against a running dev server (with `make start` and `make seed` done), from `web/`:

```sh
node scripts/contrast-audit.mjs --url http://localhost:3000 --user demo_shepherd --dark / /people /people/new "person:Marcus Reid" /prayer /review signed-out:/login register
```

It takes the same page targets as `screenshots.mjs` and checks each at 1280 and 390 wide, in light and (with `--dark`) dark. Both follow the OS setting (`prefers-color-scheme`); `--toggled` (on either script) instead sets each theme through the header's Dark mode toggle with the OS set to the opposite, to check the choice overrides it. On `person:` pages it also checks with the Log contact dialog open. It prints one line per failing node (page, width, theme, selector, colours, ratio, needed ratio) and a summary, and exits 1 on any violation. `--json <file>` also writes the results. Nodes axe can't decide (for example fields partly covered by another element) are counted as incomplete and don't fail the run.

Applied migrations (`V001`, `V002`) are excluded from SQL formatting, because changing them breaks migration checksums. Add each new migration to `.sqlfluffignore` and the `exclude` pattern in `.pre-commit-config.yaml` once it has been applied anywhere shared.

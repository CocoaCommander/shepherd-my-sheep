# shepherd-my-sheep
A full stack app to track progression of the ones we are caring for

## Sample data

`db/seed` holds a hand-written demo dataset: three users (one with nobody assigned yet) and 15 people with milestones, prayer burdens and comments, covering every business rule in `CLAUDE.md`. It is opt-in and never part of the migrations.

```sh
pip install -r tests/requirements.txt
docker compose up -d db
set -a; source .env; set +a      # needs SEED_USER_PASSWORD
python -m db.seed                # --reset to reload
```

Then log in as `demo_shepherd`, `demo_coleader` or `demo_newuser` with `SEED_USER_PASSWORD`. Tests get the same data through the `seeded_db` fixture, inside their rollback.

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
| Secrets | gitleaks |

One-time setup (needs Docker running):

```sh
npm ci
pre-commit install
```

Run everything with `pre-commit run --all-files`. CI runs the same hooks, plus a full-history gitleaks scan and clang-tidy.

Web component tests (vitest + Testing Library): `cd web && npm test`.

Applied migrations (`V001`, `V002`) are excluded from SQL formatting, because changing them breaks migration checksums. Add each new migration to `.sqlfluffignore` and the `exclude` pattern in `.pre-commit-config.yaml` once it has been applied anywhere shared.

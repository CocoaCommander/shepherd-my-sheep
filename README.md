# shepherd-my-sheep
A full stack app to track progression of the ones we are caring for

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

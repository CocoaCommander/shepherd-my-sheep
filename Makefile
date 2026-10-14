# Dev shortcuts. Recipes that need .env load it through $(ENV) — sourcing it
# in the shell copes with quotes and $ in values, which `include .env` does not.
ENV := set -a && . ./.env && set +a &&

.PHONY: db seed reseed test test-seed

db: ## start Postgres
	docker compose up -d --wait db

seed: db ## load demo data into the dev DB
	$(ENV) python3 -m db.seed

reseed: db ## wipe and reload demo data
	$(ENV) python3 -m db.seed --reset

test: ## run the pytest suite
	$(ENV) python3 -m pytest tests/

test-seed: ## run only the seed-data tests
	$(ENV) python3 -m pytest tests/test_seed.py

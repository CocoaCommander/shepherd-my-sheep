# Dev shortcuts. Recipes that need .env load it through $(ENV) — sourcing it
# in the shell copes with quotes and $ in values, which `include .env` does not.
ENV := set -a && . ./.env && set +a &&

# The web dev server runs in the background; its pid and log live here.
DEV_DIR := .dev
WEB_PID := $(DEV_DIR)/web.pid
WEB_LOG := $(DEV_DIR)/web.log

.PHONY: help deps check-deps start stop restart reset db seed reseed test test-seed

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

deps: ## install the Python packages the seed script and tests need
	python3 -m pip install -r tests/requirements.txt

# Fails fast, before anything is wiped, if the seed/test packages are missing.
check-deps:
	@python3 -c "import nacl, psycopg2, pytest" 2>/dev/null || \
		{ echo "Missing Python packages for $$(command -v python3); run: make deps"; exit 1; }

start: ## start Postgres, the API (rebuilt) and the web dev server
	docker compose up -d --build --wait
	@$(ENV) for i in $$(seq 1 30); do \
		curl -sf "localhost:$$API_PORT/health" >/dev/null && exit 0; sleep 1; \
	done; echo "API did not become healthy; see: docker compose logs api"; exit 1
	@mkdir -p $(DEV_DIR)
	@if [ -f $(WEB_PID) ] && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then \
		echo "Web dev server already running (pid $$(cat $(WEB_PID)))"; \
	else \
		(cd web && npm run --silent codegen) || exit 1; \
		(cd web && exec nohup node node_modules/vite/bin/vite.js --strictPort) > $(WEB_LOG) 2>&1 & \
		echo $$! > $(WEB_PID); \
		for i in $$(seq 1 30); do curl -sf localhost:3000 >/dev/null && break; sleep 1; done; \
		curl -sf localhost:3000 >/dev/null || { echo "Web dev server failed; see $(WEB_LOG)"; tail -20 $(WEB_LOG); exit 1; }; \
	fi
	@$(ENV) echo "Web: http://localhost:3000   API: http://localhost:$$API_PORT"

stop: ## stop the web dev server, the API and Postgres (data is kept)
	@if [ -f $(WEB_PID) ]; then \
		kill $$(cat $(WEB_PID)) 2>/dev/null || true; rm -f $(WEB_PID); \
		echo "Web dev server stopped"; \
	fi
	docker compose stop

restart: stop start ## stop, then start (picks up backend and web changes)

reset: check-deps ## wipe the database, start everything fresh and load demo data
	@$(MAKE) --no-print-directory stop
	docker compose down -v
	@$(MAKE) --no-print-directory start
	$(ENV) python3 -m db.seed

db: ## start Postgres
	docker compose up -d --wait db

seed: check-deps db ## load demo data into the dev DB
	$(ENV) python3 -m db.seed

reseed: check-deps db ## wipe and reload demo data
	$(ENV) python3 -m db.seed --reset

test: check-deps ## run the pytest suite
	$(ENV) python3 -m pytest tests/

test-seed: check-deps ## run only the seed-data tests
	$(ENV) python3 -m pytest tests/test_seed.py

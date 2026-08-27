"""
Shared fixtures for the test suite.

Spins up a connection to the Postgres container (from docker-compose),
runs the migration, and provides a clean DB for each test.
"""

import os
import pytest
import psycopg2

REQUIRED_ENV = ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]
_missing = [v for v in REQUIRED_ENV if not os.getenv(v)]
if _missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(_missing)}")

DB_HOST = os.environ["POSTGRES_HOST"]
DB_PORT = os.environ["POSTGRES_PORT"]
DB_NAME = os.environ["POSTGRES_DB"]
DB_USER = os.environ["POSTGRES_USER"]
DB_PASS = os.environ["POSTGRES_PASSWORD"]

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "db", "migrations")


@pytest.fixture(scope="session")
def db_connection():
    """Single connection for the entire test session. Runs migrations if needed."""
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )
    conn.autocommit = True

    # Check if schema already exists (docker-compose mounts migrations into initdb.d)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'status')"
        )
        schema_exists = cur.fetchone()[0]

    if not schema_exists:
        migration_files = sorted(
            f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")
        )
        for filename in migration_files:
            filepath = os.path.join(MIGRATIONS_DIR, filename)
            with open(filepath, "r") as f:
                with conn.cursor() as cur:
                    cur.execute(f.read())

    yield conn
    conn.close()


@pytest.fixture()
def db(db_connection):
    """
    Per-test fixture. Wraps each test in a transaction that rolls back,
    so every test starts with a clean slate (seed data only).
    """
    db_connection.autocommit = False
    yield db_connection
    db_connection.rollback()
    db_connection.autocommit = True

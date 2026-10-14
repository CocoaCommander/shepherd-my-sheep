"""
Load the sample dataset into the dev database.

    python -m db.seed           # fails if already seeded
    python -m db.seed --reset   # remove the demo data and load it again

Reads POSTGRES_* and SEED_USER_PASSWORD from the environment. Every demo
user (demo_shepherd, demo_coleader, demo_newuser) logs in with
SEED_USER_PASSWORD.
"""

import argparse
import os
import sys

import psycopg2
from nacl import pwhash

from .seed import DEMO_PREFIX, seed, unseed

REQUIRED_ENV = [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "SEED_USER_PASSWORD",
]


def main():
    parser = argparse.ArgumentParser(prog="python -m db.seed", description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("--reset", action="store_true", help="remove existing demo data first")
    args = parser.parse_args()

    missing = [v for v in REQUIRED_ENV if not os.getenv(v)]
    if missing:
        sys.exit(f"Missing required environment variables: {', '.join(missing)}")

    # Same libsodium argon2id call and INTERACTIVE limits as the backend's
    # PasswordHasher, so the backend verifies these hashes as-is.
    password_hash = pwhash.argon2id.str(
        os.environ["SEED_USER_PASSWORD"].encode(),
        opslimit=pwhash.argon2id.OPSLIMIT_INTERACTIVE,
        memlimit=pwhash.argon2id.MEMLIMIT_INTERACTIVE,
    ).decode()

    conn = psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    try:
        with conn:  # commits on success, rolls back on error
            if args.reset:
                unseed(conn)
            else:
                with conn.cursor() as cur:
                    cur.execute('SELECT 1 FROM "user" WHERE username LIKE %s', (DEMO_PREFIX.replace("_", r"\_") + "%",))
                    if cur.fetchone():
                        sys.exit("Demo data already present. Use --reset to reload it.")
            ids = seed(conn, password_hash)
    finally:
        conn.close()

    print(f"Seeded {len(ids.users)} users and {len(ids.people)} people.")
    print(f"Log in as {DEMO_PREFIX}shepherd, {DEMO_PREFIX}coleader or {DEMO_PREFIX}newuser with SEED_USER_PASSWORD.")


if __name__ == "__main__":
    main()

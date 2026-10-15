"""
Loads the sample dataset (dataset.py) into a database.

Rows are written through the same stored procedures the backend calls,
so the seed exercises the real write path. The one exception is
timestamps: the procedures stamp everything with now(), which would make
every comment look like it was written in the same second, so seed()
backdates created_at / released_date afterwards.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

from . import dataset

DEMO_PREFIX = "demo_"


@dataclass
class SeedIds:
    """Generated UUIDs, keyed by the names used in dataset.py."""

    users: dict[str, str] = field(default_factory=dict)
    people: dict[str, str] = field(default_factory=dict)
    burdens: dict[str, str] = field(default_factory=dict)


def _days_ago(days):
    return date.today() - timedelta(days=days)


def _backdate(cur, table, row_id, column, days):
    cur.execute(
        f"UPDATE {table} SET {column} = now() - make_interval(days => %s) WHERE id = %s",
        (days, row_id),
    )


def seed(conn, password_hash, username_prefix=DEMO_PREFIX):
    """
    Insert the dataset. Every seed user gets `password_hash`. Usernames are
    `username_prefix` + the dataset username, which lets tests seed under a
    unique prefix while demo data is in the same database.

    Does not commit; the caller owns the transaction.
    """
    ids = SeedIds()
    with conn.cursor() as cur:
        cur.execute("SELECT name, id FROM status")
        statuses = dict(cur.fetchall())
        cur.execute("SELECT name, id FROM milestone")
        milestones = dict(cur.fetchall())

        for u in dataset.USERS:
            cur.execute(
                "SELECT id FROM create_user(%s, %s, %s)",
                (u.name, username_prefix + u.username, password_hash),
            )
            ids.users[u.key] = cur.fetchone()[0]

        for p in dataset.PEOPLE:
            year_met = date.today().year - p.years_since_met if p.years_since_met is not None else None
            cur.execute(
                "SELECT id FROM create_person(%s, %s, %s, %s)",
                (p.name, statuses[p.status], p.age, year_met),
            )
            person_id = cur.fetchone()[0]
            ids.people[p.key] = person_id

            # create_person doesn't take this; update_person ignores NULLs.
            cur.execute("SELECT update_person(p_id => %s, p_is_active => %s)", (person_id, p.is_active))

            for shepherd in p.shepherds:
                cur.execute("SELECT assign_person(%s, %s)", (ids.users[shepherd], person_id))

            # Logged by the first shepherd. Fractional days are allowed so the
            # demo can sit between the contact-rule boundaries (dataset.py).
            if p.last_contact_days_ago is not None:
                cur.execute(
                    "SELECT log_contact(%s, %s, now() - %s * interval '1 day')",
                    (person_id, ids.users[p.shepherds[0]], p.last_contact_days_ago),
                )

        for m in dataset.MILESTONES:
            cur.execute(
                "SELECT record_milestone(%s, %s, %s, %s, %s)",
                (
                    ids.people[m.person],
                    milestones[m.milestone],
                    ids.users[m.recorded_by],
                    _days_ago(m.days_ago) if m.days_ago is not None else None,
                    m.notes,
                ),
            )

        for b in dataset.BURDENS:
            cur.execute("SELECT id FROM create_prayer_burden(%s, %s)", (ids.people[b.person], b.content))
            burden_id = cur.fetchone()[0]
            ids.burdens[b.key] = burden_id
            if b.released_days_ago is not None:
                cur.execute("SELECT release_prayer_burden(%s)", (burden_id,))
                _backdate(cur, "prayer_burden", burden_id, "released_date", b.released_days_ago)
            _backdate(cur, "prayer_burden", burden_id, "created_at", b.days_ago)

        for c in dataset.COMMENTS:
            cur.execute(
                "SELECT id FROM create_comment(%s, %s, %s, %s)",
                (
                    ids.users[c.user],
                    ids.people[c.person],
                    c.content,
                    ids.burdens[c.burden] if c.burden else None,
                ),
            )
            _backdate(cur, "comment", cur.fetchone()[0], "created_at", c.days_ago)

    return ids


def unseed(conn, username_prefix=DEMO_PREFIX):
    """
    Delete the seed users, and every person assigned only to seed users.
    People also shepherded by a real user are kept. Cascades remove the
    rest. Does not commit.
    """
    pattern = username_prefix.replace("_", r"\_") + "%"
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM person p
            WHERE EXISTS (
                SELECT 1 FROM user_person up JOIN "user" u ON u.id = up.user_id
                WHERE up.person_id = p.id AND u.username LIKE %(pattern)s
            )
            AND NOT EXISTS (
                SELECT 1 FROM user_person up JOIN "user" u ON u.id = up.user_id
                WHERE up.person_id = p.id AND u.username NOT LIKE %(pattern)s
            )
            """,
            {"pattern": pattern},
        )
        cur.execute('DELETE FROM "user" WHERE username LIKE %s', (pattern,))

"""
Loads the sample dataset (dataset.py) into a database.

Rows are written through the same stored procedures the backend calls,
so the seed exercises the real write path, including log_contact
promoting a new contact to active on a follow-up (business rule 6). The
one exception is timestamps: the procedures stamp everything with now(),
which would make every comment look like it was written in the same
second, so seed() backdates created_at / released_date afterwards. Each
person's created_at goes back to their earliest contact, burden or
comment, so nobody looks added after they were first contacted.
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

        # Anyone promoted by a follow-up starts as a new contact; log_contact
        # moves them to their dataset status, which is checked below.
        followed_up = {c.person for c in dataset.CONTACTS if c.is_follow_up}

        for p in dataset.PEOPLE:
            initial_status = "new contact" if p.key in followed_up else p.status
            year_met = date.today().year - p.years_since_met if p.years_since_met is not None else None
            cur.execute(
                "SELECT id FROM create_person(%s, %s, %s, %s)",
                (p.name, statuses[initial_status], p.age, year_met),
            )
            person_id = cur.fetchone()[0]
            ids.people[p.key] = person_id

            # create_person doesn't take this; update_person ignores NULLs.
            cur.execute("SELECT update_person(p_id => %s, p_is_active => %s)", (person_id, p.is_active))

            for shepherd in p.shepherds:
                cur.execute("SELECT assign_person(%s, %s)", (ids.users[shepherd], person_id))

        # Oldest first, as they would have been logged.
        for c in sorted(dataset.CONTACTS, key=lambda c: -c.days_ago):
            cur.execute(
                "SELECT id FROM log_contact(%s, %s, now() - %s * interval '1 day', %s, %s)",
                (ids.people[c.person], ids.users[c.user], c.days_ago, c.is_follow_up, c.note),
            )
            # The note is written at the contact, not at seed time.
            cur.execute(
                "UPDATE comment SET created_at = cl.contacted_at, updated_at = cl.contacted_at "
                "FROM contact_log cl WHERE cl.id = %s AND comment.contact_log_id = cl.id",
                (cur.fetchone()[0],),
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

        for pr in dataset.PRAYERS:
            cur.execute(
                "SELECT id FROM record_prayer(%s, %s, now() - %s * interval '1 day')",
                (ids.people[pr.person], ids.users[pr.user], pr.days_ago),
            )
            logged = pr.logged_days_ago if pr.logged_days_ago is not None else pr.days_ago
            cur.execute(
                "UPDATE prayer_log SET created_at = now() - %s * interval '1 day' WHERE id = %s",
                (logged, cur.fetchone()[0]),
            )

        for p in dataset.PEOPLE:
            history = [
                *(c.days_ago for c in dataset.CONTACTS if c.person == p.key),
                *(b.days_ago for b in dataset.BURDENS if b.person == p.key),
                *(c.days_ago for c in dataset.COMMENTS if c.person == p.key),
                *(pr.days_ago for pr in dataset.PRAYERS if pr.person == p.key),
            ]
            if history:
                cur.execute(
                    "UPDATE person SET created_at = now() - %s * interval '1 day' - interval '1 hour' WHERE id = %s",
                    (max(history), ids.people[p.key]),
                )

        cur.execute(
            "SELECT p.id, s.name FROM person p JOIN status s ON s.id = p.status_id WHERE p.id = ANY(%s::uuid[])",
            (list(ids.people.values()),),
        )
        actual = dict(cur.fetchall())
        for p in dataset.PEOPLE:
            if actual[ids.people[p.key]] != p.status:
                raise ValueError(f"{p.key} ended up {actual[ids.people[p.key]]!r}, dataset says {p.status!r}")

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

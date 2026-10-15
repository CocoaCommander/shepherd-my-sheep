"""
Tests for the person_contact_state view: business rule 6 (contact cadence).

  - 'active': due 7 days after the last contact; due soon in the last 48h.
  - 'new contact': due 72 hours after the last contact; due soon in the
    last 24h. With no contact logged, the clock runs from created_at.
  - 'inactive' / 'lost contact': not tracked.

Times are set relative to now() inside the rolled-back test transaction,
and stay well away from each boundary so the tests can't flake.
"""

import pytest


def make_person(cur, status_name, created_hours_ago=0):
    cur.execute("SELECT id FROM status WHERE name = %s", (status_name,))
    status_id = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO person (name, status_id, created_at) "
        "VALUES ('Cadence', %s, now() - %s * interval '1 hour') RETURNING id",
        (status_id, created_hours_ago),
    )
    return cur.fetchone()[0]


def contacted(cur, person_id, hours_ago):
    cur.execute(
        "INSERT INTO contact_log (person_id, contacted_at) VALUES (%s, now() - %s * interval '1 hour')",
        (person_id, hours_ago),
    )


def state(cur, person_id):
    cur.execute(
        "SELECT contact_state, contact_due_at IS NULL FROM person_contact_state WHERE person_id = %s",
        (person_id,),
    )
    return cur.fetchone()


class TestActive:
    @pytest.mark.parametrize(
        "hours_ago, expected",
        [
            (1, "ON_TRACK"),
            (4 * 24, "ON_TRACK"),
            (5.5 * 24, "DUE_SOON"),  # within 48h of the 7-day deadline
            (7 * 24 + 1, "OVERDUE"),
            (30 * 24, "OVERDUE"),
        ],
    )
    def test_weekly_deadline(self, db, hours_ago, expected):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            contacted(cur, person_id, hours_ago)
            assert state(cur, person_id) == (expected, False)

    def test_latest_contact_counts(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            contacted(cur, person_id, 30 * 24)
            contacted(cur, person_id, 2)
            assert state(cur, person_id) == ("ON_TRACK", False)

    def test_due_at_is_seven_days_after_last_contact(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active")
            contacted(cur, person_id, 24)
            cur.execute(
                "SELECT contact_due_at = last_contacted_at + interval '7 days' "
                "FROM person_contact_state WHERE person_id = %s",
                (person_id,),
            )
            assert cur.fetchone()[0]

    def test_never_contacted_runs_from_created_at(self, db):
        with db.cursor() as cur:
            fresh = make_person(cur, "active", created_hours_ago=1)
            old = make_person(cur, "active", created_hours_ago=8 * 24)
            assert state(cur, fresh) == ("ON_TRACK", False)
            assert state(cur, old) == ("OVERDUE", False)


class TestNewContact:
    @pytest.mark.parametrize(
        "hours_ago, expected",
        [
            (1, "ON_TRACK"),
            (24, "ON_TRACK"),
            (49, "DUE_SOON"),  # within 24h of the 72-hour deadline
            (73, "OVERDUE"),
        ],
    )
    def test_72_hour_deadline(self, db, hours_ago, expected):
        with db.cursor() as cur:
            person_id = make_person(cur, "new contact", created_hours_ago=30 * 24)
            contacted(cur, person_id, hours_ago)
            assert state(cur, person_id) == (expected, False)

    @pytest.mark.parametrize(
        "created_hours_ago, expected",
        [(1, "ON_TRACK"), (49, "DUE_SOON"), (73, "OVERDUE")],
    )
    def test_never_contacted_runs_from_created_at(self, db, created_hours_ago, expected):
        with db.cursor() as cur:
            person_id = make_person(cur, "new contact", created_hours_ago=created_hours_ago)
            assert state(cur, person_id) == (expected, False)

    def test_follow_up_switches_to_the_weekly_rule(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "new contact", created_hours_ago=30 * 24)
            cur.execute("SELECT log_contact(%s, NULL, now() - interval '4 days', true)", (person_id,))
            # 4 days is overdue for a new contact, but on track once active.
            assert state(cur, person_id) == ("ON_TRACK", False)


class TestNotTracked:
    @pytest.mark.parametrize("status_name", ["inactive", "lost contact"])
    def test_not_tracked(self, db, status_name):
        with db.cursor() as cur:
            person_id = make_person(cur, status_name, created_hours_ago=365 * 24)
            assert state(cur, person_id) == ("NOT_TRACKED", True)
            contacted(cur, person_id, 400 * 24)
            assert state(cur, person_id) == ("NOT_TRACKED", True)

    def test_last_contacted_at_still_shown(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "inactive")
            contacted(cur, person_id, 5)
            cur.execute(
                "SELECT last_contacted_at IS NOT NULL FROM person_contact_state WHERE person_id = %s", (person_id,)
            )
            assert cur.fetchone()[0]


class TestEveryPerson:
    def test_view_has_one_row_per_person(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active")
            contacted(cur, person_id, 1)
            contacted(cur, person_id, 2)
            cur.execute("SELECT count(*) FROM person_contact_state WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 1
            cur.execute("SELECT (SELECT count(*) FROM person) = (SELECT count(*) FROM person_contact_state)")
            assert cur.fetchone()[0]

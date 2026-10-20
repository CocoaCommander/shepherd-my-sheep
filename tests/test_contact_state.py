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


def clock(cur, person_id):
    cur.execute(
        "SELECT contact_clock_start, contact_due_at FROM person_contact_state WHERE person_id = %s",
        (person_id,),
    )
    return cur.fetchone()


def status_changed_at(cur, person_id):
    cur.execute("SELECT status_changed_at FROM person WHERE id = %s", (person_id,))
    return cur.fetchone()[0]


def move_to(cur, person_id, status_name):
    """Changes the status by hand, the way the API's updatePerson does."""
    cur.execute("SELECT id FROM status WHERE name = %s", (status_name,))
    cur.execute("SELECT update_person(p_id := %s, p_status_id := %s)", (person_id, cur.fetchone()[0]))


def near(cur, value, offset="0 seconds"):
    """True if value is within a minute of now() + offset (now() is fixed in the transaction)."""
    cur.execute(
        "SELECT abs(extract(epoch FROM (%s::timestamptz - (now() + %s::interval)))) < 60",
        (value, offset),
    )
    return cur.fetchone()[0]


class TestContactClockStart:
    def test_no_move_no_contact_is_created_at(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=48)
            cur.execute(
                "SELECT s.contact_clock_start = p.created_at FROM person_contact_state s "
                "JOIN person p ON p.id = s.person_id WHERE s.person_id = %s",
                (person_id,),
            )
            assert cur.fetchone()[0]
            assert status_changed_at(cur, person_id) is None

    def test_no_move_with_contacts_is_latest_contact(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            contacted(cur, person_id, 30 * 24)
            contacted(cur, person_id, 5)
            cur.execute(
                "SELECT contact_clock_start = last_contacted_at FROM person_contact_state WHERE person_id = %s",
                (person_id,),
            )
            assert cur.fetchone()[0]
            assert near(cur, clock(cur, person_id)[0], "-5 hours")

    def test_inactive_then_active_restarts_an_overdue_person(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            contacted(cur, person_id, 10 * 24)
            assert state(cur, person_id) == ("OVERDUE", False)

            move_to(cur, person_id, "inactive")
            move_to(cur, person_id, "active")
            start, due = clock(cur, person_id)
            assert state(cur, person_id) == ("ON_TRACK", False)
            assert near(cur, start)
            assert near(cur, due, "7 days")

    def test_manual_move_to_new_contact_gives_72_hours(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            contacted(cur, person_id, 10 * 24)
            move_to(cur, person_id, "new contact")
            start, due = clock(cur, person_id)
            assert state(cur, person_id) == ("ON_TRACK", False)
            assert near(cur, start)
            assert near(cur, due, "72 hours")

    def test_contact_after_the_move_starts_the_clock(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            move_to(cur, person_id, "inactive")
            move_to(cur, person_id, "active")
            # Pretend the move was 3 days ago; a contact an hour ago is later.
            cur.execute("UPDATE person SET status_changed_at = now() - interval '3 days' WHERE id = %s", (person_id,))
            contacted(cur, person_id, 1)
            assert near(cur, clock(cur, person_id)[0], "-1 hour")

    def test_back_dated_contact_does_not_pull_the_clock_back(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=60 * 24)
            move_to(cur, person_id, "inactive")
            move_to(cur, person_id, "active")
            contacted(cur, person_id, 10 * 24)
            start, due = clock(cur, person_id)
            assert near(cur, start)
            assert near(cur, due, "7 days")
            assert state(cur, person_id) == ("ON_TRACK", False)

    def test_same_status_does_not_restart_the_clock(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=8 * 24)
            move_to(cur, person_id, "active")
            assert status_changed_at(cur, person_id) is None
            assert state(cur, person_id) == ("OVERDUE", False)

    def test_same_status_leaves_an_earlier_change_unchanged(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active")
            cur.execute("UPDATE person SET status_changed_at = now() - interval '2 days' WHERE id = %s", (person_id,))
            before = status_changed_at(cur, person_id)
            move_to(cur, person_id, "active")
            assert status_changed_at(cur, person_id) == before

    def test_name_and_age_changes_do_not_restart_the_clock(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active", created_hours_ago=8 * 24)
            cur.execute("SELECT update_person(p_id := %s, p_name := 'Renamed', p_age := 40)", (person_id,))
            assert status_changed_at(cur, person_id) is None
            assert state(cur, person_id) == ("OVERDUE", False)

    def test_manual_move_sets_status_changed_at(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active")
            assert status_changed_at(cur, person_id) is None
            move_to(cur, person_id, "lost contact")
            assert near(cur, status_changed_at(cur, person_id))

    def test_promotion_by_log_contact_leaves_status_changed_at_null(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "new contact", created_hours_ago=30 * 24)
            cur.execute("SELECT log_contact(%s, NULL, now() - interval '4 days', true)", (person_id,))
            assert status_changed_at(cur, person_id) is None
            # The back-dated follow-up counts from its contacted_at.
            assert near(cur, clock(cur, person_id)[0], "-4 days")

    def test_delete_contact_revert_leaves_status_changed_at_unchanged(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "new contact")
            cur.execute("SELECT log_contact(%s, NULL, now(), true)", (person_id,))
            cur.execute("SELECT id FROM contact_log WHERE person_id = %s", (person_id,))
            contact_id = cur.fetchone()[0]
            before = status_changed_at(cur, person_id)
            cur.execute("SELECT delete_contact(%s)", (contact_id,))
            cur.execute("SELECT s.name FROM person p JOIN status s ON s.id = p.status_id WHERE p.id = %s", (person_id,))
            assert cur.fetchone()[0] == "new contact"
            assert status_changed_at(cur, person_id) == before

    @pytest.mark.parametrize("status_name", ["inactive", "lost contact"])
    def test_clock_start_null_when_not_tracked(self, db, status_name):
        with db.cursor() as cur:
            person_id = make_person(cur, status_name, created_hours_ago=30 * 24)
            contacted(cur, person_id, 5)
            assert clock(cur, person_id) == (None, None)

    def test_person_with_no_contacts_has_a_row_with_a_clock(self, db):
        with db.cursor() as cur:
            person_id = make_person(cur, "active")
            row = clock(cur, person_id)
            assert row is not None and row[0] is not None

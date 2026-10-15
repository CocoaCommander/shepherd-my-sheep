"""
Tests for the sample dataset. They guard the edge cases the dataset is
meant to cover, so trimming the demo data can't silently drop one.
"""


def count(cur, sql, *params):
    cur.execute(sql, params)
    return cur.fetchone()[0]


class TestSeed:
    def test_loads_everything(self, seeded_db):
        conn, ids = seeded_db
        assert len(ids.users) == 3
        assert len(ids.people) == 15
        with conn.cursor() as cur:
            people = list(ids.people.values())
            assert count(cur, "SELECT count(*) FROM milestone_person WHERE person_id = ANY(%s::uuid[])", people) > 0
            assert count(cur, "SELECT count(*) FROM comment WHERE person_id = ANY(%s::uuid[])", people) > 0

    def test_user_with_no_people(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            assert count(cur, "SELECT count(*) FROM user_person WHERE user_id = %s", ids.users["newuser"]) == 0

    def test_person_with_nothing_recorded(self, seeded_db):
        conn, ids = seeded_db
        person = ids.people["just_met"]
        with conn.cursor() as cur:
            for table in ("milestone_person", "prayer_burden", "comment", "contact_log"):
                assert count(cur, f"SELECT count(*) FROM {table} WHERE person_id = %s", person) == 0
            cur.execute("SELECT age FROM person WHERE id = %s", (person,))
            assert cur.fetchone() == (None,)

    def test_burden_with_no_comments(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            burden = ids.burdens["aisha_settling"]
            assert count(cur, "SELECT count(*) FROM comment WHERE prayer_burden_id = %s", burden) == 0

    def test_standalone_and_linked_comments(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            person = ids.people["maria"]
            sql = "SELECT count(*) FROM comment WHERE person_id = %s AND prayer_burden_id IS {} NULL"
            assert count(cur, sql.format(""), person) > 0
            assert count(cur, sql.format("NOT"), person) > 0

    def test_shared_person(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            assert count(cur, "SELECT count(*) FROM user_person WHERE person_id = %s", ids.people["maria"]) == 2

    def test_released_and_active_burdens(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT released_date IS NOT NULL, released_date > created_at FROM prayer_burden WHERE id = %s",
                (ids.burdens["james_job"],),
            )
            assert cur.fetchone() == (True, True)
            assert (
                count(
                    cur,
                    "SELECT count(*) FROM prayer_burden WHERE id = %s AND released_date IS NULL",
                    ids.burdens["maria_mother"],
                )
                == 1
            )

    def test_comments_are_backdated(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            assert (
                count(
                    cur,
                    "SELECT count(DISTINCT created_at::date) FROM comment WHERE person_id = %s",
                    ids.people["maria"],
                )
                > 1
            )

    def test_every_status_used(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(DISTINCT status_id) = (SELECT count(*) FROM status) FROM person WHERE id = ANY(%s::uuid[])",
                (list(ids.people.values()),),
            )
            assert cur.fetchone()[0]

    def test_every_contact_state_covered(self, seeded_db):
        """The states listed in dataset.py's docstring (business rule 6)."""
        conn, ids = seeded_db
        expected = {
            "ON_TRACK": {"maria", "rachel", "just_met"},
            "DUE_SOON": {"david", "hannah", "aisha"},
            "OVERDUE": {"elena", "james", "priya", "marcus", "ben"},
            "NOT_TRACKED": {"kenji", "lucy", "omar", "sofia"},
        }
        key_by_id = {str(v): k for k, v in ids.people.items()}
        with conn.cursor() as cur:
            cur.execute(
                "SELECT person_id, contact_state FROM person_contact_state WHERE person_id = ANY(%s::uuid[])",
                (list(ids.people.values()),),
            )
            actual = {}
            for person_id, state in cur.fetchall():
                actual.setdefault(state, set()).add(key_by_id[str(person_id)])
        assert actual == expected

    def test_contacts_are_logged_by_a_shepherd(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM contact_log cl "
                "WHERE cl.person_id = ANY(%s::uuid[]) "
                "AND NOT EXISTS (SELECT 1 FROM user_person up "
                "                WHERE up.person_id = cl.person_id AND up.user_id = cl.user_id)",
                (list(ids.people.values()),),
            )
            assert cur.fetchone()[0] == 0

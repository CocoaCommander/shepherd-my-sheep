"""
Tests for the PostgreSQL schema — seed data, constraints, triggers.
Uses raw SQL for structural checks (these don't go through app logic).
"""

import psycopg2
import pytest

# ── Helpers ──────────────────────────────────────────────────


def get_status_id(cur, name="active"):
    cur.execute("SELECT id FROM status WHERE name = %s", (name,))
    return cur.fetchone()[0]


def get_milestone_id(cur, name="baptised"):
    cur.execute("SELECT id FROM milestone WHERE name = %s", (name,))
    return cur.fetchone()[0]


# ── Seed Data ────────────────────────────────────────────────


class TestSeedData:
    def test_statuses_seeded(self, db):
        with db.cursor() as cur:
            cur.execute("SELECT name FROM status ORDER BY name")
            names = [row[0] for row in cur.fetchall()]
        assert names == ["active", "inactive", "lost contact", "new contact"]

    def test_milestones_seeded(self, db):
        with db.cursor() as cur:
            cur.execute("SELECT name FROM milestone ORDER BY name")
            names = [row[0] for row in cur.fetchall()]
        assert names == ["baptised", "joined small group", "leading", "serving"]


# ── Foreign Key Constraints ──────────────────────────────────


class TestForeignKeys:
    def test_person_requires_valid_status(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.ForeignKeyViolation):
                cur.execute(
                    "INSERT INTO person (name, status_id) VALUES ('Nobody', %s)",
                    (fake_uuid,),
                )


# ── Updated-at Trigger ───────────────────────────────────────


class TestUpdatedAtTrigger:
    def test_person_updated_at_changes_on_update(self, db):
        with db.cursor() as cur:
            status_id = get_status_id(cur)
            cur.execute(
                "SELECT * FROM create_person(%s, %s)",
                ("Trigger Test", status_id),
            )
            person_id = cur.fetchone()[0]
            cur.execute("SELECT updated_at FROM person WHERE id = %s", (person_id,))
            original = cur.fetchone()[0]

            cur.execute(
                "SELECT * FROM update_person(p_id := %s, p_name := %s)",
                (person_id, "Updated Name"),
            )
            cur.execute("SELECT updated_at FROM person WHERE id = %s", (person_id,))
            updated = cur.fetchone()[0]

            assert updated >= original

    def test_prayer_burden_updated_at_on_release(self, db):
        with db.cursor() as cur:
            status_id = get_status_id(cur)
            cur.execute("SELECT * FROM create_person(%s, %s)", ("Burden Test", status_id))
            person_id = cur.fetchone()[0]

            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_id, "test burden"),
            )
            row = cur.fetchone()
            burden_id = row[0]
            original = row[4]  # created_at

            cur.execute("SELECT * FROM release_prayer_burden(%s)", (burden_id,))
            cur.execute("SELECT updated_at FROM prayer_burden WHERE id = %s", (burden_id,))
            updated = cur.fetchone()[0]

            assert updated >= original


# ── Contact log (business rule 6) ────────────────────────────


class TestContactLog:
    def test_last_contact_date_column_is_gone(self, db):
        with db.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'person' AND column_name = 'last_contact_date'"
            )
            assert cur.fetchone()[0] == 0

    def test_contacted_at_is_a_timestamp(self, db):
        with db.cursor() as cur:
            cur.execute(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'contact_log' AND column_name = 'contacted_at'"
            )
            assert cur.fetchone()[0] == "timestamp with time zone"

    def test_deleting_person_deletes_contacts(self, db):
        with db.cursor() as cur:
            cur.execute("INSERT INTO person (name, status_id) VALUES ('Gone', %s) RETURNING id", (get_status_id(cur),))
            person_id = cur.fetchone()[0]
            cur.execute("INSERT INTO contact_log (person_id) VALUES (%s)", (person_id,))
            cur.execute("DELETE FROM person WHERE id = %s", (person_id,))
            cur.execute("SELECT count(*) FROM contact_log WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_deleting_user_keeps_their_contacts(self, db):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO \"user\" (name, username, password_hash) VALUES ('U', 'cl_user', 'x') RETURNING id"
            )
            user_id = cur.fetchone()[0]
            cur.execute("INSERT INTO person (name, status_id) VALUES ('Kept', %s) RETURNING id", (get_status_id(cur),))
            person_id = cur.fetchone()[0]
            cur.execute("INSERT INTO contact_log (person_id, user_id) VALUES (%s, %s)", (person_id, user_id))
            cur.execute('DELETE FROM "user" WHERE id = %s', (user_id,))
            cur.execute("SELECT user_id FROM contact_log WHERE person_id = %s", (person_id,))
            assert cur.fetchone() == (None,)

    def test_contact_note_lives_in_comment(self, db):
        with db.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_name = 'contact_log' AND column_name = 'note'"
            )
            assert cur.fetchone()[0] == 0

    def test_deleting_contact_deletes_its_note(self, db):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO \"user\" (name, username, password_hash) VALUES ('U', 'note_user', 'x') RETURNING id"
            )
            user_id = cur.fetchone()[0]
            cur.execute("INSERT INTO person (name, status_id) VALUES ('Noted', %s) RETURNING id", (get_status_id(cur),))
            person_id = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO contact_log (person_id, user_id) VALUES (%s, %s) RETURNING id", (person_id, user_id)
            )
            contact_id = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO comment (user_id, person_id, content, contact_log_id) VALUES (%s, %s, 'Hi', %s)",
                (user_id, person_id, contact_id),
            )
            cur.execute("DELETE FROM contact_log WHERE id = %s", (contact_id,))
            cur.execute("SELECT count(*) FROM comment WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_one_note_per_contact(self, db):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO \"user\" (name, username, password_hash) VALUES ('U', 'note_user2', 'x') RETURNING id"
            )
            user_id = cur.fetchone()[0]
            cur.execute("INSERT INTO person (name, status_id) VALUES ('Noted', %s) RETURNING id", (get_status_id(cur),))
            person_id = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO contact_log (person_id, user_id) VALUES (%s, %s) RETURNING id", (person_id, user_id)
            )
            contact_id = cur.fetchone()[0]
            insert = "INSERT INTO comment (user_id, person_id, content, contact_log_id) VALUES (%s, %s, 'Hi', %s)"
            cur.execute(insert, (user_id, person_id, contact_id))
            with pytest.raises(psycopg2.errors.UniqueViolation):
                cur.execute(insert, (user_id, person_id, contact_id))


# ── Person checks ────────────────────────────────────────────


class TestPersonChecks:
    @pytest.mark.parametrize(
        "name, age, year_met",
        [
            ("", None, None),
            ("   ", None, None),
            ("Aged", -1, None),
            ("Aged", 121, None),
            ("Met", None, 1899),
        ],
    )
    def test_out_of_range_rejected(self, db, name, age, year_met):
        with db.cursor() as cur:
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute(
                    "INSERT INTO person (name, age, year_met, status_id) VALUES (%s, %s, %s, %s)",
                    (name, age, year_met, get_status_id(cur)),
                )

    @pytest.mark.parametrize("age, year_met", [(0, 1900), (120, None), (None, None)])
    def test_bounds_and_nulls_allowed(self, db, age, year_met):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO person (name, age, year_met, status_id) VALUES ('Ok', %s, %s, %s)",
                (age, year_met, get_status_id(cur)),
            )

    def test_create_person_rejects_a_future_year(self, db):
        with db.cursor() as cur:
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute(
                    "SELECT * FROM create_person('Later', %s, NULL, extract(year FROM now() + interval '14 hours')::int + 1)",
                    (get_status_id(cur),),
                )

    def test_create_person_allows_this_year(self, db):
        with db.cursor() as cur:
            cur.execute(
                "SELECT year_met FROM create_person('Now', %s, NULL, extract(year FROM now())::int)",
                (get_status_id(cur),),
            )
            assert cur.fetchone()[0] is not None

    def test_update_person_rejects_a_future_year(self, db):
        with db.cursor() as cur:
            cur.execute("SELECT id FROM create_person('Later', %s)", (get_status_id(cur),))
            person_id = cur.fetchone()[0]
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute(
                    "SELECT * FROM update_person(p_id := %s, p_year_met := extract(year FROM now() + interval '14 hours')::int + 1)",
                    (person_id,),
                )

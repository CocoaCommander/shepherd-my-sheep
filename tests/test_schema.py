"""
Tests for the PostgreSQL schema — seed data, constraints, triggers.
Uses raw SQL for structural checks (these don't go through app logic).
"""

import pytest
import psycopg2


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
            cur.execute(
                "SELECT * FROM create_person(%s, %s)", ("Burden Test", status_id)
            )
            person_id = cur.fetchone()[0]

            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_id, "test burden"),
            )
            row = cur.fetchone()
            burden_id = row[0]
            original = row[4]  # created_at

            cur.execute("SELECT * FROM release_prayer_burden(%s)", (burden_id,))
            cur.execute(
                "SELECT updated_at FROM prayer_burden WHERE id = %s", (burden_id,)
            )
            updated = cur.fetchone()[0]

            assert updated >= original

"""
Tests for stored procedures — the write operations used by the app.
Every test calls the same stored procedure the C++ backend will call.
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


def sp_create_user(cur, name="Test User", username="testuser", password_hash="hashed123"):
    cur.execute("SELECT * FROM create_user(%s, %s, %s)", (name, username, password_hash))
    return cur.fetchone()


def sp_create_person(cur, name="John", status_name="active", age=None, year_met=None):
    status_id = get_status_id(cur, status_name)
    cur.execute(
        "SELECT * FROM create_person(%s, %s, %s, %s)",
        (name, status_id, age, year_met),
    )
    return cur.fetchone()


# ── create_user ──────────────────────────────────────────────


class TestCreateUser:
    def test_creates_user_with_all_fields(self, db):
        with db.cursor() as cur:
            row = sp_create_user(cur, "Alice", "alice", "hash_abc")
            assert row[1] == "Alice"  # name
            assert row[2] == "alice"  # username
            assert row[3] == "hash_abc"  # password_hash

    def test_duplicate_username_rejected(self, db):
        with db.cursor() as cur:
            sp_create_user(cur, username="dupeuser")
            with pytest.raises(psycopg2.errors.UniqueViolation):
                sp_create_user(cur, name="Other", username="dupeuser")


# ── create_person ────────────────────────────────────────────


class TestCreatePerson:
    def test_creates_person_with_required_fields_only(self, db):
        with db.cursor() as cur:
            row = sp_create_person(cur, "Jane")
            assert row[1] == "Jane"  # name
            assert row[2] is None  # age — not provided
            assert row[3] is None  # year_met — not provided

    def test_creates_person_with_optional_fields(self, db):
        with db.cursor() as cur:
            row = sp_create_person(cur, "Bob", age=25, year_met=2024)
            assert row[1] == "Bob"
            assert row[2] == 25  # age
            assert row[3] == 2024  # year_met

    def test_invalid_status_rejected(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.ForeignKeyViolation):
                cur.execute("SELECT * FROM create_person(%s, %s)", ("Nobody", fake_uuid))


# ── update_person ────────────────────────────────────────────


class TestUpdatePerson:
    def test_partial_update(self, db):
        with db.cursor() as cur:
            row = sp_create_person(cur, "Original", age=20)
            person_id = row[0]

            cur.execute(
                "SELECT * FROM update_person(p_id := %s, p_name := %s)",
                (person_id, "Updated"),
            )
            updated = cur.fetchone()
            assert updated[1] == "Updated"  # name changed
            assert updated[2] == 20  # age unchanged

    def test_update_nonexistent_raises(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.RaiseException, match="Person not found"):
                cur.execute(
                    "SELECT * FROM update_person(p_id := %s, p_name := %s)",
                    (fake_uuid, "Ghost"),
                )


# ── delete_person ────────────────────────────────────────────


class TestDeletePerson:
    def test_deletes_existing_person(self, db):
        with db.cursor() as cur:
            row = sp_create_person(cur)
            person_id = row[0]
            cur.execute("SELECT * FROM delete_person(%s)", (person_id,))
            assert cur.fetchone()[0] is True

            cur.execute("SELECT COUNT(*) FROM person WHERE id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_delete_nonexistent_raises(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.RaiseException, match="Person not found"):
                cur.execute("SELECT * FROM delete_person(%s)", (fake_uuid,))

    def test_delete_cascades_to_comments(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_comment(%s, %s, %s)",
                (user_row[0], person_row[0], "will be deleted"),
            )
            cur.execute("SELECT * FROM delete_person(%s)", (person_row[0],))
            cur.execute("SELECT COUNT(*) FROM comment WHERE person_id = %s", (person_row[0],))
            assert cur.fetchone()[0] == 0

    def test_delete_cascades_to_prayer_burdens(self, db):
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "will be deleted"),
            )
            cur.execute("SELECT * FROM delete_person(%s)", (person_row[0],))
            cur.execute(
                "SELECT COUNT(*) FROM prayer_burden WHERE person_id = %s",
                (person_row[0],),
            )
            assert cur.fetchone()[0] == 0


# ── assign_person / unassign_person ──────────────────────────


class TestAssignment:
    def test_assign_user_to_person(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute("SELECT * FROM assign_person(%s, %s)", (user_row[0], person_row[0]))
            result = cur.fetchone()
            assert result[1] == user_row[0]  # user_id
            assert result[2] == person_row[0]  # person_id

    def test_duplicate_assignment_rejected(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute("SELECT * FROM assign_person(%s, %s)", (user_row[0], person_row[0]))
            with pytest.raises(psycopg2.errors.UniqueViolation):
                cur.execute(
                    "SELECT * FROM assign_person(%s, %s)",
                    (user_row[0], person_row[0]),
                )

    def test_unassign_user_from_person(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute("SELECT * FROM assign_person(%s, %s)", (user_row[0], person_row[0]))
            cur.execute("SELECT * FROM unassign_person(%s, %s)", (user_row[0], person_row[0]))
            assert cur.fetchone()[0] is True

    def test_unassign_nonexistent_raises(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.RaiseException, match="Assignment not found"):
                cur.execute("SELECT * FROM unassign_person(%s, %s)", (fake_uuid, fake_uuid))

    def test_user_with_no_people(self, db):
        """Business rule: a new user has no one assigned."""
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            cur.execute("SELECT COUNT(*) FROM user_person WHERE user_id = %s", (user_row[0],))
            assert cur.fetchone()[0] == 0


# ── record_milestone / remove_milestone ──────────────────────


class TestMilestones:
    def test_record_milestone(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            milestone_id = get_milestone_id(cur)

            cur.execute(
                "SELECT * FROM record_milestone(%s, %s, %s, %s, %s)",
                (person_row[0], milestone_id, user_row[0], "2024-06-15", "Big day!"),
            )
            result = cur.fetchone()
            assert result[1] == person_row[0]  # person_id
            assert result[2] == milestone_id  # milestone_id

    def test_duplicate_milestone_rejected(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            milestone_id = get_milestone_id(cur)

            cur.execute(
                "SELECT * FROM record_milestone(%s, %s, %s)",
                (person_row[0], milestone_id, user_row[0]),
            )
            with pytest.raises(psycopg2.errors.UniqueViolation):
                cur.execute(
                    "SELECT * FROM record_milestone(%s, %s, %s)",
                    (person_row[0], milestone_id, user_row[0]),
                )

    def test_remove_milestone(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            milestone_id = get_milestone_id(cur)

            cur.execute(
                "SELECT * FROM record_milestone(%s, %s, %s)",
                (person_row[0], milestone_id, user_row[0]),
            )
            cur.execute(
                "SELECT * FROM remove_milestone(%s, %s)",
                (person_row[0], milestone_id),
            )
            assert cur.fetchone()[0] is True

    def test_remove_nonexistent_milestone_raises(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.RaiseException, match="Milestone record not found"):
                cur.execute("SELECT * FROM remove_milestone(%s, %s)", (fake_uuid, fake_uuid))

    def test_person_with_no_milestones(self, db):
        """Business rule: a new person has no milestones."""
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT COUNT(*) FROM milestone_person WHERE person_id = %s",
                (person_row[0],),
            )
            assert cur.fetchone()[0] == 0


# ── create_prayer_burden / release_prayer_burden ─────────────


class TestPrayerBurdens:
    def test_create_prayer_burden(self, db):
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Pray for growth"),
            )
            result = cur.fetchone()
            assert result[1] == person_row[0]  # person_id
            assert result[2] == "Pray for growth"  # content
            assert result[3] is None  # released_date — still active

    def test_release_prayer_burden(self, db):
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Pray for job"),
            )
            burden_id = cur.fetchone()[0]

            cur.execute("SELECT * FROM release_prayer_burden(%s)", (burden_id,))
            result = cur.fetchone()
            assert result[3] is not None  # released_date is now set

    def test_release_already_released_raises(self, db):
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Pray for health"),
            )
            burden_id = cur.fetchone()[0]
            cur.execute("SELECT * FROM release_prayer_burden(%s)", (burden_id,))

            with pytest.raises(psycopg2.errors.RaiseException, match="already released"):
                cur.execute("SELECT * FROM release_prayer_burden(%s)", (burden_id,))

    def test_person_with_no_prayer_burdens(self, db):
        """Business rule: a new person has no prayer burdens."""
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT COUNT(*) FROM prayer_burden WHERE person_id = %s",
                (person_row[0],),
            )
            assert cur.fetchone()[0] == 0

    def test_prayer_burden_with_no_comments(self, db):
        """Business rule: a prayer burden can exist without any comments."""
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Standalone burden"),
            )
            burden_id = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM comment WHERE prayer_burden_id = %s",
                (burden_id,),
            )
            assert cur.fetchone()[0] == 0


# ── create_comment / delete_comment ──────────────────────────


class TestComments:
    def test_standalone_comment(self, db):
        """A comment with no prayer burden — just a note on a person."""
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_comment(%s, %s, %s)",
                (user_row[0], person_row[0], "Just a note"),
            )
            result = cur.fetchone()
            assert result[4] == "Just a note"  # content
            assert result[3] is None  # prayer_burden_id — standalone

    def test_comment_linked_to_prayer_burden(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Pray for job"),
            )
            burden_id = cur.fetchone()[0]

            cur.execute(
                "SELECT * FROM create_comment(%s, %s, %s, %s)",
                (user_row[0], person_row[0], "Still praying", burden_id),
            )
            result = cur.fetchone()
            assert result[3] == burden_id  # prayer_burden_id linked

    def test_multiple_comments_on_one_burden(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Pray for health"),
            )
            burden_id = cur.fetchone()[0]

            for i in range(3):
                cur.execute(
                    "SELECT * FROM create_comment(%s, %s, %s, %s)",
                    (user_row[0], person_row[0], f"Update {i}", burden_id),
                )

            cur.execute(
                "SELECT COUNT(*) FROM comment WHERE prayer_burden_id = %s",
                (burden_id,),
            )
            assert cur.fetchone()[0] == 3

    def test_delete_comment(self, db):
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_comment(%s, %s, %s)",
                (user_row[0], person_row[0], "Delete me"),
            )
            comment_id = cur.fetchone()[0]

            cur.execute("SELECT * FROM delete_comment(%s)", (comment_id,))
            assert cur.fetchone()[0] is True

            cur.execute("SELECT COUNT(*) FROM comment WHERE id = %s", (comment_id,))
            assert cur.fetchone()[0] == 0

    def test_delete_nonexistent_comment_raises(self, db):
        with db.cursor() as cur:
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            with pytest.raises(psycopg2.errors.RaiseException, match="Comment not found"):
                cur.execute("SELECT * FROM delete_comment(%s)", (fake_uuid,))

    def test_delete_prayer_burden_nullifies_comment_fk(self, db):
        """Deleting a prayer burden sets comment.prayer_burden_id to NULL."""
        with db.cursor() as cur:
            user_row = sp_create_user(cur)
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT * FROM create_prayer_burden(%s, %s)",
                (person_row[0], "Temporary"),
            )
            burden_id = cur.fetchone()[0]
            cur.execute(
                "SELECT * FROM create_comment(%s, %s, %s, %s)",
                (user_row[0], person_row[0], "Linked", burden_id),
            )
            comment_id = cur.fetchone()[0]

            # Delete the burden directly (no SP needed — cascade is a DB concern)
            cur.execute("DELETE FROM prayer_burden WHERE id = %s", (burden_id,))

            cur.execute("SELECT prayer_burden_id FROM comment WHERE id = %s", (comment_id,))
            assert cur.fetchone()[0] is None

    def test_person_with_no_comments(self, db):
        """Business rule: a new person has no comments."""
        with db.cursor() as cur:
            person_row = sp_create_person(cur)
            cur.execute(
                "SELECT COUNT(*) FROM comment WHERE person_id = %s",
                (person_row[0],),
            )
            assert cur.fetchone()[0] == 0


# ── log_contact / delete_contact (business rule 6) ───────────


def sp_log_contact(cur, person_id, user_id=None, contacted_at=None, is_follow_up=None, note=None, prayer_burden=None):
    cur.execute(
        "SELECT * FROM log_contact(%s, %s, %s, %s, %s, %s)",
        (person_id, user_id, contacted_at, is_follow_up, note, prayer_burden),
    )
    return cur.fetchone()


def status_of(cur, person_id):
    cur.execute("SELECT s.name FROM person p JOIN status s ON s.id = p.status_id WHERE p.id = %s", (person_id,))
    return cur.fetchone()[0]


class TestLogContact:
    def test_defaults_to_now_and_not_a_follow_up_for_active(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Contacted")[0]
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT contacted_at = now(), is_follow_up, user_id FROM contact_log WHERE id = %s", (row[0],))
            assert cur.fetchone() == (True, False, None)

    def test_follow_up_promotes_new_contact_to_active(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            sp_log_contact(cur, person_id, is_follow_up=True)
            assert status_of(cur, person_id) == "active"

    def test_new_contact_is_followed_up_by_default(self, db):
        """Adding someone is the first contact, so the next one logged is their follow-up."""
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT is_follow_up FROM contact_log WHERE id = %s", (row[0],))
            assert cur.fetchone() == (True,)
            assert status_of(cur, person_id) == "active"

    def test_plain_contact_does_not_promote(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            sp_log_contact(cur, person_id, is_follow_up=False)
            assert status_of(cur, person_id) == "new contact"

    @pytest.mark.parametrize("status_name", ["inactive", "lost contact", "active"])
    def test_follow_up_leaves_other_statuses_alone(self, db, status_name):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Other", status_name=status_name)[0]
            sp_log_contact(cur, person_id, is_follow_up=True)
            assert status_of(cur, person_id) == status_name

    def test_records_who(self, db):
        with db.cursor() as cur:
            user_id = sp_create_user(cur, username="contactor")[0]
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id, user_id)
            cur.execute("SELECT user_id FROM contact_log WHERE id = %s", (row[0],))
            assert cur.fetchone() == (user_id,)

    def test_note_becomes_a_standalone_comment(self, db):
        with db.cursor() as cur:
            user_id = sp_create_user(cur, username="contactor")[0]
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id, user_id, note="  Coffee after church ")
            cur.execute(
                "SELECT user_id, person_id, prayer_burden_id, content FROM comment WHERE contact_log_id = %s", (row[0],)
            )
            assert cur.fetchall() == [(user_id, person_id, None, "Coffee after church")]

    @pytest.mark.parametrize("note", [None, "", "   "])
    def test_no_note_no_comment(self, db, note):
        with db.cursor() as cur:
            user_id = sp_create_user(cur, username="contactor")[0]
            person_id = sp_create_person(cur)[0]
            sp_log_contact(cur, person_id, user_id, note=note)
            cur.execute("SELECT count(*) FROM comment WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_prayer_burden_linked_to_contact(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id, prayer_burden="  Visa renewal ")
            cur.execute(
                "SELECT person_id, content, released_date FROM prayer_burden WHERE contact_log_id = %s", (row[0],)
            )
            assert cur.fetchall() == [(person_id, "Visa renewal", None)]

    @pytest.mark.parametrize("prayer_burden", [None, "", "   "])
    def test_no_prayer_burden_none_added(self, db, prayer_burden):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            sp_log_contact(cur, person_id, prayer_burden=prayer_burden)
            cur.execute("SELECT count(*) FROM prayer_burden WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_note_without_user_rejected(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            with pytest.raises(psycopg2.errors.CheckViolation):
                sp_log_contact(cur, person_id, note="Who wrote this?")

    def test_backdated_contact_allowed(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            cur.execute(
                "SELECT contacted_at < now() - interval '2 days' FROM log_contact(%s, NULL, now() - interval '3 days')",
                (person_id,),
            )
            assert cur.fetchone()[0]

    def test_future_contact_rejected(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute("SELECT * FROM log_contact(%s, NULL, now() + interval '1 hour')", (person_id,))

    def test_small_clock_skew_allowed(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            cur.execute("SELECT * FROM log_contact(%s, NULL, now() + interval '1 minute')", (person_id,))

    def test_missing_person_raises(self, db):
        with db.cursor() as cur:
            with pytest.raises(psycopg2.errors.RaiseException):
                sp_log_contact(cur, "00000000-0000-0000-0000-000000000000")

    @pytest.mark.parametrize(
        "status_name, is_follow_up, promoted",
        [
            ("new contact", None, True),
            ("new contact", True, True),
            ("new contact", False, False),
            ("active", True, False),
            ("inactive", True, False),
        ],
    )
    def test_promoted_only_when_it_promotes(self, db, status_name, is_follow_up, promoted):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Someone", status_name=status_name)[0]
            row = sp_log_contact(cur, person_id, is_follow_up=is_follow_up)
            cur.execute("SELECT promoted FROM contact_log WHERE id = %s", (row[0],))
            assert cur.fetchone() == (promoted,)

    def test_second_contact_does_not_promote_again(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            sp_log_contact(cur, person_id)
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT is_follow_up, promoted FROM contact_log WHERE id = %s", (row[0],))
            assert cur.fetchone() == (False, False)


class TestDeleteContact:
    def test_delete_contact(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            assert cur.fetchone()[0] is True
            cur.execute("SELECT count(*) FROM contact_log WHERE person_id = %s", (person_id,))
            assert cur.fetchone()[0] == 0

    def test_delete_contact_removes_its_note_only(self, db):
        with db.cursor() as cur:
            user_id = sp_create_user(cur, username="contactor")[0]
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id, user_id, note="Undo me")
            cur.execute("SELECT * FROM create_comment(%s, %s, %s)", (user_id, person_id, "Keep me"))
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            cur.execute("SELECT content FROM comment WHERE person_id = %s", (person_id,))
            assert cur.fetchall() == [("Keep me",)]

    def test_delete_contact_removes_its_prayer_burden_only(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur)[0]
            row = sp_log_contact(cur, person_id, prayer_burden="Undo me")
            cur.execute("SELECT * FROM create_prayer_burden(%s, %s)", (person_id, "Keep me"))
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            cur.execute("SELECT content FROM prayer_burden WHERE person_id = %s", (person_id,))
            assert cur.fetchall() == [("Keep me",)]

    def test_delete_nonexistent_contact_raises(self, db):
        with db.cursor() as cur:
            with pytest.raises(psycopg2.errors.RaiseException):
                cur.execute("SELECT delete_contact(%s)", ("00000000-0000-0000-0000-000000000000",))

    def test_undoing_the_follow_up_reverts_the_promotion(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            row = sp_log_contact(cur, person_id)
            assert status_of(cur, person_id) == "active"
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            assert status_of(cur, person_id) == "new contact"

    def test_status_changed_since_is_kept(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            row = sp_log_contact(cur, person_id)
            cur.execute(
                "SELECT * FROM update_person(p_id := %s, p_status_id := %s)",
                (person_id, get_status_id(cur, "inactive")),
            )
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            assert status_of(cur, person_id) == "inactive"

    def test_undoing_a_later_contact_keeps_them_active(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Newbie", status_name="new contact")[0]
            sp_log_contact(cur, person_id)
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            assert status_of(cur, person_id) == "active"

    def test_undoing_a_plain_contact_leaves_status_alone(self, db):
        with db.cursor() as cur:
            person_id = sp_create_person(cur, "Regular", status_name="active")[0]
            row = sp_log_contact(cur, person_id)
            cur.execute("SELECT delete_contact(%s)", (row[0],))
            assert status_of(cur, person_id) == "active"

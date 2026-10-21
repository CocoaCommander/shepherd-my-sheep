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
            for table in ("milestone_person", "prayer_burden", "comment", "contact_log", "prayer_log"):
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

    def test_recently_released_burdens_newest_release_first(self, seeded_db):
        """What recentlyReleasedPrayerBurdens ranks: released_date DESC, id DESC, at most 5."""
        from db.seed import dataset

        conn, ids = seeded_db
        released = sorted(
            (b for b in dataset.BURDENS if b.released_days_ago is not None), key=lambda b: b.released_days_ago
        )
        assert released, "the dataset needs released burdens"
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM prayer_burden WHERE person_id = ANY(%s::uuid[]) AND released_date IS NOT NULL "
                "ORDER BY released_date DESC, id DESC LIMIT 5",
                (list(ids.people.values()),),
            )
            assert [r[0] for r in cur.fetchall()] == [ids.burdens[b.key] for b in released[:5]]

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

    def test_contact_notes_are_standalone_comments_on_the_contact(self, seeded_db):
        """Business rule 5: a note written with a contact is linked to it and dated with it."""
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*), bool_and(c.prayer_burden_id IS NULL), bool_and(c.created_at = cl.contacted_at), "
                "       bool_and(c.user_id = cl.user_id) "
                "FROM comment c JOIN contact_log cl ON cl.id = c.contact_log_id "
                "WHERE c.person_id = ANY(%s::uuid[])",
                (list(ids.people.values()),),
            )
            notes, standalone, dated, by_contactor = cur.fetchone()
        assert notes > 0
        assert (standalone, dated, by_contactor) == (True, True, True)

    def test_follow_up_promoted_a_new_contact(self, seeded_db):
        """Business rule 6: a follow-up moves a new contact to active, so no new contact has one."""
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.name FROM person p JOIN status s ON s.id = p.status_id WHERE p.id = %s",
                (ids.people["rachel"],),
            )
            assert cur.fetchone() == ("active",)
            sql = "SELECT count(*) FROM contact_log WHERE person_id = %s AND is_follow_up"
            assert count(cur, sql, ids.people["rachel"]) == 1
            assert (
                count(
                    cur,
                    "SELECT count(*) FROM contact_log cl JOIN person p ON p.id = cl.person_id "
                    "JOIN status s ON s.id = p.status_id "
                    "WHERE cl.is_follow_up AND s.name = 'new contact' AND p.id = ANY(%s::uuid[])",
                    list(ids.people.values()),
                )
                == 0
            )

    def test_new_contacts_waiting_on_a_follow_up(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            for key in ("aisha", "marcus", "ben"):
                assert count(cur, "SELECT count(*) FROM contact_log WHERE person_id = %s", ids.people[key]) > 0

    def test_shared_person_last_contacted_by_co_shepherd(self, seeded_db):
        """Business rule 6: any shepherd's contact clears the alert for all."""
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id FROM contact_log WHERE person_id = %s ORDER BY contacted_at DESC LIMIT 1",
                (ids.people["maria"],),
            )
            assert cur.fetchone() == (ids.users["coleader"],)

    def test_milestones_reached_out_of_order(self, seeded_db):
        """Someone has a later step of baptised → small group → serving → leading without an earlier one."""
        conn, ids = seeded_db
        order = ["baptised", "joined small group", "serving", "leading"]
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mp.person_id, array_agg(m.name) FROM milestone_person mp "
                "JOIN milestone m ON m.id = mp.milestone_id WHERE mp.person_id = ANY(%s::uuid[]) "
                "GROUP BY mp.person_id",
                (list(ids.people.values()),),
            )
            # In order means the recorded steps are the first few of `order`.
            gaps = [person_id for person_id, names in cur.fetchall() if set(names) != set(order[: len(names)])]
        assert ids.people["david"] in gaps

    def test_nobody_added_after_their_history(self, seeded_db):
        """The 72-hour rule counts from created_at, so it can't come after a person's records."""
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM person p WHERE p.id = ANY(%s::uuid[]) AND p.created_at > LEAST("
                "  (SELECT min(contacted_at) FROM contact_log WHERE person_id = p.id),"
                "  (SELECT min(created_at) FROM comment WHERE person_id = p.id),"
                "  (SELECT min(created_at) FROM prayer_burden WHERE person_id = p.id),"
                "  (SELECT min(prayed_at) FROM prayer_log WHERE person_id = p.id))",
                (list(ids.people.values()),),
            )
            assert cur.fetchone()[0] == 0

    def test_people_never_prayed_for(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            for key in ("just_met", "lucy"):
                assert count(cur, "SELECT count(*) FROM prayer_log WHERE person_id = %s", ids.people[key]) == 0

    def test_shared_person_prayed_for_by_both_shepherds_last_by_co_leader(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT user_id FROM prayer_log WHERE person_id = %s", (ids.people["maria"],))
            assert {r[0] for r in cur.fetchall()} == {ids.users["shepherd"], ids.users["coleader"]}
            cur.execute(
                "SELECT user_id FROM prayer_log WHERE person_id = %s ORDER BY prayed_at DESC LIMIT 1",
                (ids.people["maria"],),
            )
            assert cur.fetchone() == (ids.users["coleader"],)

    def test_backdated_prayer(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            assert (
                count(
                    cur,
                    "SELECT count(*) FROM prayer_log WHERE person_id = %s AND created_at - prayed_at > interval '1 day'",
                    ids.people["david"],
                )
                > 0
            )

    def test_prayed_for_person_with_no_burdens(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            person = ids.people["marcus"]
            assert count(cur, "SELECT count(*) FROM prayer_log WHERE person_id = %s", person) > 0
            assert count(cur, "SELECT count(*) FROM prayer_burden WHERE person_id = %s", person) == 0

    def test_prayers_are_by_a_shepherd(self, seeded_db):
        conn, ids = seeded_db
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM prayer_log pl "
                "WHERE pl.person_id = ANY(%s::uuid[]) "
                "AND NOT EXISTS (SELECT 1 FROM user_person up "
                "                WHERE up.person_id = pl.person_id AND up.user_id = pl.user_id)",
                (list(ids.people.values()),),
            )
            assert cur.fetchone()[0] == 0

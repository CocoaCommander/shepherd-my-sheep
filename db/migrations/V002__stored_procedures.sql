-- ============================================================
-- Shepherd My Sheep — Stored Procedures (Write Operations)
-- ============================================================

-- ── User ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_user(
    p_name          VARCHAR,
    p_username      VARCHAR,
    p_password_hash VARCHAR
)
RETURNS "user" AS $$
DECLARE
    result "user";
BEGIN
    INSERT INTO "user" (name, username, password_hash)
    VALUES (p_name, p_username, p_password_hash)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── Person ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_person(
    p_name      VARCHAR,
    p_status_id UUID,
    p_age       INT DEFAULT NULL,
    p_year_met  INT DEFAULT NULL
)
RETURNS person AS $$
DECLARE
    result person;
BEGIN
    INSERT INTO person (name, age, year_met, status_id)
    VALUES (p_name, p_age, p_year_met, p_status_id)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION update_person(
    p_id                UUID,
    p_name              VARCHAR           DEFAULT NULL,
    p_age               INT               DEFAULT NULL,
    p_year_met          INT               DEFAULT NULL,
    p_last_contact_date DATE              DEFAULT NULL,
    p_is_active         BOOLEAN           DEFAULT NULL,
    p_status_id         UUID              DEFAULT NULL
)
RETURNS person AS $$
DECLARE
    result person;
BEGIN
    UPDATE person SET
        name              = COALESCE(p_name,              name),
        age               = COALESCE(p_age,               age),
        year_met          = COALESCE(p_year_met,          year_met),
        last_contact_date = COALESCE(p_last_contact_date, last_contact_date),
        is_active         = COALESCE(p_is_active,         is_active),
        status_id         = COALESCE(p_status_id,         status_id)
    WHERE id = p_id
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION delete_person(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM person WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ── User ↔ Person Assignment ────────────────────────────────

CREATE OR REPLACE FUNCTION assign_person(
    p_user_id   UUID,
    p_person_id UUID
)
RETURNS user_person AS $$
DECLARE
    result user_person;
BEGIN
    INSERT INTO user_person (user_id, person_id)
    VALUES (p_user_id, p_person_id)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION unassign_person(
    p_user_id   UUID,
    p_person_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM user_person
    WHERE user_id = p_user_id AND person_id = p_person_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found for user % and person %', p_user_id, p_person_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ── Milestones ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_milestone(
    p_person_id    UUID,
    p_milestone_id UUID,
    p_recorded_by  UUID,
    p_date_achieved DATE DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL
)
RETURNS milestone_person AS $$
DECLARE
    result milestone_person;
BEGIN
    INSERT INTO milestone_person (person_id, milestone_id, recorded_by, date_achieved, notes)
    VALUES (p_person_id, p_milestone_id, p_recorded_by, p_date_achieved, p_notes)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION remove_milestone(
    p_person_id    UUID,
    p_milestone_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM milestone_person
    WHERE person_id = p_person_id AND milestone_id = p_milestone_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone record not found for person % and milestone %', p_person_id, p_milestone_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ── Prayer Burdens ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_prayer_burden(
    p_person_id UUID,
    p_content   TEXT
)
RETURNS prayer_burden AS $$
DECLARE
    result prayer_burden;
BEGIN
    INSERT INTO prayer_burden (person_id, content)
    VALUES (p_person_id, p_content)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION release_prayer_burden(p_id UUID)
RETURNS prayer_burden AS $$
DECLARE
    result prayer_burden;
BEGIN
    UPDATE prayer_burden
    SET released_date = now()
    WHERE id = p_id AND released_date IS NULL
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prayer burden not found or already released: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── Comments ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_comment(
    p_user_id          UUID,
    p_person_id        UUID,
    p_content          TEXT,
    p_prayer_burden_id UUID DEFAULT NULL
)
RETURNS comment AS $$
DECLARE
    result comment;
BEGIN
    INSERT INTO comment (user_id, person_id, content, prayer_burden_id)
    VALUES (p_user_id, p_person_id, p_content, p_prayer_burden_id)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION delete_comment(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM comment WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found: %', p_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

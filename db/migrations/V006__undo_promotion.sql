-- ============================================================
-- Shepherd My Sheep — Undo reverts a promotion; person checks
-- ============================================================
--
-- A contact logged for a 'new contact' moves them to 'active' (business
-- rule 6). Undoing that contact (delete_contact) now moves them back, but
-- only if they are still 'active': a status set by hand since then stays.
--
-- person gets the checks the Add person form uses: a non-blank name, an
-- age of 0-120 and a year met from 1900 to the current year.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- True when this contact moved the person from 'new contact' to 'active'.
-- Existing rows stay false: history can't tell which contact promoted
-- someone, so undoing an older contact never changes the status.
-- A constant default doesn't rewrite the table on Postgres 11+.
ALTER TABLE contact_log ADD COLUMN IF NOT EXISTS promoted BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Person checks ───────────────────────────────────────────
-- Added unvalidated, then validated, so the checks don't block writes.
-- Dropped first so the migration can be rerun; it only ever drops the
-- constraints added just below.

-- squawk-ignore ban-drop-constraint
ALTER TABLE person DROP CONSTRAINT IF EXISTS person_name_not_blank;
ALTER TABLE person ADD CONSTRAINT person_name_not_blank CHECK (btrim(name) <> '') NOT VALID;
ALTER TABLE person VALIDATE CONSTRAINT person_name_not_blank;

-- squawk-ignore ban-drop-constraint
ALTER TABLE person DROP CONSTRAINT IF EXISTS person_age_range;
ALTER TABLE person ADD CONSTRAINT person_age_range CHECK (age BETWEEN 0 AND 120) NOT VALID;
ALTER TABLE person VALIDATE CONSTRAINT person_age_range;

-- The upper bound (the current year) can't be a CHECK, as now() isn't
-- immutable; create_person and update_person enforce it instead.
-- squawk-ignore ban-drop-constraint
ALTER TABLE person DROP CONSTRAINT IF EXISTS person_year_met_min;
ALTER TABLE person ADD CONSTRAINT person_year_met_min CHECK (year_met >= 1900) NOT VALID;
ALTER TABLE person VALIDATE CONSTRAINT person_year_met_min;

-- ── Person ──────────────────────────────────────────────────

-- The current year in the earliest time zone (UTC+14), so a device that
-- has already reached New Year's Day isn't rejected.
CREATE OR REPLACE FUNCTION check_year_met(p_year_met INT)
RETURNS VOID AS $$
BEGIN
    IF p_year_met > extract(YEAR FROM now() + INTERVAL '14 hours') THEN
        RAISE EXCEPTION 'Year met is in the future'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Same signature as V002; the year met is checked first.
CREATE OR REPLACE FUNCTION create_person(
    p_name VARCHAR,
    p_status_id UUID,
    p_age INT DEFAULT NULL,
    p_year_met INT DEFAULT NULL
)
RETURNS PERSON AS $$
DECLARE
    result person;
BEGIN
    PERFORM check_year_met(p_year_met);

    INSERT INTO person (name, age, year_met, status_id)
    VALUES (p_name, p_age, p_year_met, p_status_id)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Same signature as V003; the year met is checked first.
CREATE OR REPLACE FUNCTION update_person(
    p_id UUID,
    p_name VARCHAR DEFAULT NULL,
    p_age INT DEFAULT NULL,
    p_year_met INT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL,
    p_status_id UUID DEFAULT NULL
)
RETURNS PERSON AS $$
DECLARE
    result person;
BEGIN
    PERFORM check_year_met(p_year_met);

    UPDATE person SET
        name              = COALESCE(p_name,              name),
        age               = COALESCE(p_age,               age),
        year_met          = COALESCE(p_year_met,          year_met),
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

-- ── Contacts ────────────────────────────────────────────────

-- Same signature as V005; a contact that promotes the person is marked
-- promoted, so delete_contact can undo it.
CREATE OR REPLACE FUNCTION log_contact(
    p_person_id UUID,
    p_user_id UUID,
    p_contacted_at TIMESTAMPTZ DEFAULT now(),
    p_is_follow_up BOOLEAN DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_prayer_burden TEXT DEFAULT NULL
)
RETURNS CONTACT_LOG AS $$
DECLARE
    result       contact_log;
    status_name  VARCHAR;
    v_note       TEXT := NULLIF(btrim(p_note), '');
    v_burden     TEXT := NULLIF(btrim(p_prayer_burden), '');
    v_follow_up  BOOLEAN;
    v_promotes   BOOLEAN;
BEGIN
    -- Locked so a concurrent status change can't race the promotion below.
    SELECT s.name INTO status_name
    FROM person p JOIN status s ON s.id = p.status_id
    WHERE p.id = p_person_id
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_person_id;
    END IF;

    -- A little slack for clocks that disagree.
    IF p_contacted_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'Contact time is in the future'
            USING ERRCODE = 'check_violation';
    END IF;

    -- A comment needs an author.
    IF v_note IS NOT NULL AND p_user_id IS NULL THEN
        RAISE EXCEPTION 'A contact note needs the user who made contact'
            USING ERRCODE = 'check_violation';
    END IF;

    -- A null flag means "a follow-up if they are a new contact".
    v_follow_up := COALESCE(p_is_follow_up, status_name = 'new contact');
    v_promotes  := v_follow_up AND status_name = 'new contact';

    INSERT INTO contact_log (person_id, user_id, contacted_at, is_follow_up, promoted)
    VALUES (p_person_id, p_user_id, COALESCE(p_contacted_at, now()), v_follow_up, v_promotes)
    RETURNING * INTO result;

    IF v_note IS NOT NULL THEN
        INSERT INTO comment (user_id, person_id, content, contact_log_id)
        VALUES (p_user_id, p_person_id, v_note, result.id);
    END IF;

    IF v_burden IS NOT NULL THEN
        INSERT INTO prayer_burden (person_id, content, contact_log_id)
        VALUES (p_person_id, v_burden, result.id);
    END IF;

    IF v_promotes THEN
        UPDATE person
        SET status_id = (SELECT id FROM status WHERE name = 'active')
        WHERE id = p_person_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Removes a logged contact (e.g. Undo); its note and burden cascade. If
-- this contact promoted the person and they are still 'active', they go
-- back to 'new contact'.
CREATE OR REPLACE FUNCTION delete_contact(p_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_person_id UUID;
    v_promoted  BOOLEAN;
BEGIN
    SELECT person_id INTO v_person_id FROM contact_log WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contact not found: %', p_id;
    END IF;

    -- Person first, as in log_contact, so the two can't deadlock and a
    -- concurrent status change can't race the revert below.
    PERFORM 1 FROM person WHERE id = v_person_id FOR UPDATE;

    DELETE FROM contact_log WHERE id = p_id
    RETURNING promoted INTO v_promoted;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contact not found: %', p_id;
    END IF;

    IF v_promoted THEN
        UPDATE person
        SET status_id = (SELECT id FROM status WHERE name = 'new contact')
        WHERE id = v_person_id
          AND status_id = (SELECT id FROM status WHERE name = 'active');
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

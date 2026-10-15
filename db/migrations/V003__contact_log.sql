-- ============================================================
-- Shepherd My Sheep — Contact log and contact cadence
-- ============================================================
--
-- Business rule 6 (contact cadence):
--   - an 'active' person must be contacted at least every 7 days;
--   - a 'new contact' must be followed up within 72 hours. With nothing
--     logged yet, the clock runs from when the person was added;
--   - logging a follow-up moves a 'new contact' to 'active';
--   - 'inactive' and 'lost contact' people are not tracked.
--
-- Contacts are logged with a timestamp (a DATE can't measure 72 hours),
-- which replaces person.last_contact_date.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS contact_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id UUID NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    -- Who made contact; null if unknown or deleted. "user" is reserved, so it stays quoted.
    user_id UUID REFERENCES "user" (id) ON DELETE SET NULL,  -- noqa: RF06
    contacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The table was created just above and is empty, so nothing is blocked.
-- (CONCURRENTLY can't run inside the single transaction tests apply this in.)
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_contact_log_person ON contact_log (person_id, contacted_at DESC);

-- Keep existing last-contact dates as history (who made contact is unknown).
INSERT INTO contact_log (person_id, contacted_at)
SELECT
    id,
    last_contact_date::TIMESTAMPTZ
FROM person
WHERE last_contact_date IS NOT NULL;

-- update_person loses its last-contact parameter, so its signature changes
-- and it has to be dropped rather than replaced. The backend is updated in
-- the same change, and the API keeps a deprecated lastContactDate.
-- squawk-ignore ban-drop-function
DROP FUNCTION IF EXISTS update_person(UUID, VARCHAR, INT, INT, DATE, BOOLEAN, UUID);

-- Its data now lives in contact_log (copied above).
-- squawk-ignore ban-drop-column
ALTER TABLE person DROP COLUMN IF EXISTS last_contact_date;

CREATE FUNCTION update_person(
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

-- ── Contact state ───────────────────────────────────────────
-- One row per person. contact_due_at is null and contact_state is
-- 'NOT_TRACKED' for anyone the rule doesn't cover. "Due soon" starts
-- 48 hours before the weekly deadline and 24 hours before the 72-hour one.

CREATE VIEW person_contact_state AS
WITH clock AS (
    SELECT
        p.id AS person_id,
        lc.last_contacted_at,
        CASE s.name
            WHEN 'active' THEN coalesce(lc.last_contacted_at, p.created_at) + INTERVAL '7 days'
            WHEN 'new contact' THEN coalesce(lc.last_contacted_at, p.created_at) + INTERVAL '72 hours'
        END AS contact_due_at,
        CASE s.name
            WHEN 'active' THEN INTERVAL '48 hours'
            WHEN 'new contact' THEN INTERVAL '24 hours'
        END AS due_soon_window
    FROM person AS p
    INNER JOIN status AS s ON p.status_id = s.id
    LEFT JOIN LATERAL (
        SELECT max(cl.contacted_at) AS last_contacted_at
        FROM contact_log AS cl
        WHERE cl.person_id = p.id
    ) AS lc ON TRUE
)

SELECT
    person_id,
    last_contacted_at,
    contact_due_at,
    CASE
        WHEN contact_due_at IS NULL THEN 'NOT_TRACKED'
        WHEN now() > contact_due_at THEN 'OVERDUE'
        WHEN now() > contact_due_at - due_soon_window THEN 'DUE_SOON'
        ELSE 'ON_TRACK'
    END AS contact_state
FROM clock;

-- ── Contacts ────────────────────────────────────────────────

-- A follow-up on a 'new contact' makes them 'active' (business rule 6).
CREATE FUNCTION log_contact(
    p_person_id UUID,
    p_user_id UUID,
    p_contacted_at TIMESTAMPTZ DEFAULT now(),
    p_is_follow_up BOOLEAN DEFAULT FALSE,
    p_note TEXT DEFAULT NULL
)
RETURNS CONTACT_LOG AS $$
DECLARE
    result      contact_log;
    status_name VARCHAR;
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

    INSERT INTO contact_log (person_id, user_id, contacted_at, is_follow_up, note)
    VALUES (p_person_id, p_user_id, COALESCE(p_contacted_at, now()), COALESCE(p_is_follow_up, false), p_note)
    RETURNING * INTO result;

    IF result.is_follow_up AND status_name = 'new contact' THEN
        UPDATE person
        SET status_id = (SELECT id FROM status WHERE name = 'active')
        WHERE id = p_person_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


-- Removes a logged contact (e.g. Undo). Does not undo a promotion.
CREATE FUNCTION delete_contact(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM contact_log WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contact not found: %', p_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

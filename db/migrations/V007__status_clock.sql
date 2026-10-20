-- ============================================================
-- Shepherd My Sheep — A status move restarts the contact clock
-- ============================================================
--
-- Moving someone back to 'active' or 'new contact' by hand restarts their
-- contact clock from the move (business rule 6), so they aren't overdue the
-- moment they come back from 'inactive' or 'lost contact'. A contact logged
-- after the move takes over again, as it is later.
--
-- person_contact_state also exposes when the current window started, so
-- clients don't hard-code the 7-day and 72-hour windows.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- When the status was last changed by hand (update_person). Null means it
-- hasn't changed since the person was added. Not backfilled: history can't
-- tell when a status was set.
ALTER TABLE person ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- ── Person ──────────────────────────────────────────────────

-- Same signature as V006. A new status stamps status_changed_at; re-saving
-- the same status doesn't restart the clock. This isn't a trigger on
-- status_id, as log_contact's promotion and delete_contact's revert must
-- not stamp: the contact itself restarts the clock (from its own, maybe
-- back-dated, time), and Undo should leave things as if it never happened.
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
        status_id         = COALESCE(p_status_id,         status_id),
        status_changed_at = CASE
            WHEN p_status_id IS NOT NULL AND p_status_id IS DISTINCT FROM status_id
            THEN now()
            ELSE status_changed_at
        END
    WHERE id = p_id
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── Contact state ───────────────────────────────────────────
-- One row per person. The clock starts at the latest contact (or when the
-- person was added, if none), or at a later status move. contact_clock_start
-- and contact_due_at are null and contact_state is 'NOT_TRACKED' for anyone
-- the rule doesn't cover. "Due soon" starts 48 hours before the weekly
-- deadline and 24 hours before the 72-hour one.
-- Same columns as V003; contact_clock_start is added last, as CREATE OR
-- REPLACE VIEW can only append columns.

CREATE OR REPLACE VIEW person_contact_state AS
WITH clock AS (
    SELECT
        p.id AS person_id,
        lc.last_contacted_at,
        -- greatest() ignores nulls, so no move means the contact or created_at.
        greatest(coalesce(lc.last_contacted_at, p.created_at), p.status_changed_at) AS clock_start,
        CASE s.name
            WHEN 'active' THEN INTERVAL '7 days'
            WHEN 'new contact' THEN INTERVAL '72 hours'
        END AS contact_window,
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
),

due AS (
    SELECT
        person_id,
        last_contacted_at,
        due_soon_window,
        clock_start + contact_window AS contact_due_at,
        CASE WHEN contact_window IS NOT NULL THEN clock_start END AS contact_clock_start
    FROM clock
)

-- Columns stay in V003's order; CREATE OR REPLACE VIEW can't reorder them.
SELECT  -- noqa: ST06
    person_id,
    last_contacted_at,
    contact_due_at,
    CASE
        WHEN contact_due_at IS NULL THEN 'NOT_TRACKED'
        WHEN now() > contact_due_at THEN 'OVERDUE'
        WHEN now() > contact_due_at - due_soon_window THEN 'DUE_SOON'
        ELSE 'ON_TRACK'
    END AS contact_state,
    contact_clock_start
FROM due;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

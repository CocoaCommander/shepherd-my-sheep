-- ============================================================
-- Shepherd My Sheep — Undo a status move without restarting the clock
-- ============================================================
--
-- A status move by hand stamps status_changed_at (V007), which restarts the
-- contact clock. Undoing a move with another update_person would stamp it
-- again: someone 14 days overdue, moved to 'inactive' by mistake and moved
-- straight back, would come back on track with a fresh 7-day clock, and
-- their alert would disappear for every shepherd (business rule 6).
--
-- So update_person keeps the status and stamp it replaced, and
-- revert_status_change puts both back. Only the server does this: trusting
-- a client-supplied stamp would let any shepherd push a clock forward and
-- silence an alert. The restored stamp is always earlier than the one it
-- replaces, so a revert can only bring an alert back, never hide one; it
-- needs no time limit. Undo goes back one move.
--
-- Contacts logged after the move stay, and still restart the clock, as
-- the clock starts at the later of the last contact and the stamp.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- The status and stamp the last hand move replaced. Null when there is
-- nothing to undo: never moved, or the move was already undone.
ALTER TABLE person ADD COLUMN IF NOT EXISTS previous_status_id UUID;
ALTER TABLE person ADD COLUMN IF NOT EXISTS previous_status_changed_at TIMESTAMPTZ;

-- Added unvalidated, then validated, so the key doesn't block writes.
-- Dropped first so the migration can be rerun; it only ever drops the
-- constraint added just below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE person DROP CONSTRAINT IF EXISTS person_previous_status_id_fkey;

ALTER TABLE person
ADD CONSTRAINT person_previous_status_id_fkey
FOREIGN KEY (previous_status_id) REFERENCES status (id) NOT VALID;

ALTER TABLE person VALIDATE CONSTRAINT person_previous_status_id_fkey;

-- ── Person ──────────────────────────────────────────────────

-- Same signature as V007. A new status also saves the old status and stamp
-- in previous_*. log_contact's promotion and delete_contact's revert don't
-- stamp, so they don't touch previous_* either; revert_status_change's
-- status check catches a promotion since the move.
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

    -- On the right of SET, columns are the row's values before the update.
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
        END,
        previous_status_id = CASE
            WHEN p_status_id IS NOT NULL AND p_status_id IS DISTINCT FROM status_id
            THEN status_id
            ELSE previous_status_id
        END,
        previous_status_changed_at = CASE
            WHEN p_status_id IS NOT NULL AND p_status_id IS DISTINCT FROM status_id
            THEN status_changed_at
            ELSE previous_status_changed_at
        END
    WHERE id = p_id
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Undoes the last hand move (e.g. the board's Undo). The caller names the
-- move: the status it set and the stamp it got (Person.statusChangedAt).
-- It is undone only if nothing has changed since: the person still has
-- that status (no later move, no promotion by a contact) and that stamp
-- (no later move away and back). Otherwise it raises
-- object_not_in_prerequisite_state, which the API reports as CONFLICT.
-- Stamps compare as timestamptz, so the text form doesn't matter.
CREATE OR REPLACE FUNCTION revert_status_change(
    p_id UUID,
    p_status_id UUID,
    p_status_changed_at TIMESTAMPTZ
)
RETURNS PERSON AS $$
DECLARE
    v_person person;
    result  person;
BEGIN
    -- Locked so a concurrent move or promotion can't slip in between the
    -- check and the revert.
    SELECT * INTO v_person FROM person WHERE id = p_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_id;
    END IF;

    IF v_person.previous_status_id IS NULL
       OR v_person.status_id IS DISTINCT FROM p_status_id
       OR v_person.status_changed_at IS DISTINCT FROM p_status_changed_at THEN
        RAISE EXCEPTION 'Status has changed since'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    UPDATE person SET
        status_id                  = previous_status_id,
        status_changed_at          = previous_status_changed_at,
        previous_status_id         = NULL,
        previous_status_changed_at = NULL
    WHERE id = p_id
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

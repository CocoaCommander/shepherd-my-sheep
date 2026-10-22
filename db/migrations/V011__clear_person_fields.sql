-- ============================================================
-- Shepherd My Sheep — Clear age and year met
-- ============================================================
--
-- update_person COALESCEs every field, so a null argument means "leave
-- unchanged" and a value, once set, can never be removed. Age and year
-- met are optional (a person we've just met may have neither), so the
-- edit form has to be able to empty them again.
--
-- A null can't carry both meanings, so clearing gets its own flags:
-- p_clear_age and p_clear_year_met. They default to false, so every
-- existing call (all named) keeps its meaning. A clear flag together with
-- a value is a caller bug, and raises.
--
-- Clearing touches only age and year_met: the status, its stamp and
-- previous_* are left alone, so the contact clock and Undo of a move are
-- unaffected (business rule 6).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ── Person ──────────────────────────────────────────────────

-- New parameters change the signature, so the V009 function is dropped
-- rather than replaced; an overload with defaults would make the existing
-- named calls ambiguous. The backend is updated in the same change.
-- squawk-ignore ban-drop-function
DROP FUNCTION IF EXISTS update_person(UUID, VARCHAR, INT, INT, BOOLEAN, UUID);

-- The V009 body, with age and year_met cleared on request.
CREATE FUNCTION update_person(
    p_id UUID,
    p_name VARCHAR DEFAULT NULL,
    p_age INT DEFAULT NULL,
    p_year_met INT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL,
    p_status_id UUID DEFAULT NULL,
    p_clear_age BOOLEAN DEFAULT FALSE,
    p_clear_year_met BOOLEAN DEFAULT FALSE
)
RETURNS PERSON AS $$
DECLARE
    result person;
BEGIN
    IF p_clear_age AND p_age IS NOT NULL THEN
        RAISE EXCEPTION 'Age can''t be both set and cleared'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_clear_year_met AND p_year_met IS NOT NULL THEN
        RAISE EXCEPTION 'Year met can''t be both set and cleared'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    PERFORM check_year_met(p_year_met);

    -- On the right of SET, columns are the row's values before the update.
    UPDATE person SET
        name              = COALESCE(p_name,              name),
        age               = CASE WHEN p_clear_age THEN NULL
                                 ELSE COALESCE(p_age, age) END,
        year_met          = CASE WHEN p_clear_year_met THEN NULL
                                 ELSE COALESCE(p_year_met, year_met) END,
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

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

-- ============================================================
-- Shepherd My Sheep — Prayer burdens logged with a contact
-- ============================================================
--
-- The "Log contact" modal takes a date, a note and an optional prayer
-- burden. A burden added there is linked to the contact like its note
-- (business rule 5), so undoing the contact (delete_contact) removes both.
--
-- A shepherd adding someone is their first contact, so any contact logged
-- for a 'new contact' is their follow-up and moves them to 'active'
-- (business rule 6). log_contact now works that out when no flag is given.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE prayer_burden ADD COLUMN IF NOT EXISTS contact_log_id UUID;

-- Added unvalidated, then validated, so the check doesn't block writes.
-- Dropped first so the migration can be rerun; it only ever drops the
-- constraint added just below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE prayer_burden DROP CONSTRAINT IF EXISTS prayer_burden_contact_log_id_fkey;

ALTER TABLE prayer_burden
ADD CONSTRAINT prayer_burden_contact_log_id_fkey
FOREIGN KEY (contact_log_id) REFERENCES contact_log (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE prayer_burden VALIDATE CONSTRAINT prayer_burden_contact_log_id_fkey;

-- prayer_burden is small before launch, and CONCURRENTLY can't run inside
-- the single transaction tests apply this in.
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX IF NOT EXISTS idx_prayer_burden_contact_log ON prayer_burden (contact_log_id)
WHERE contact_log_id IS NOT NULL;

-- log_contact gains a burden parameter, so its signature changes and it
-- has to be dropped rather than replaced (an overload would make the
-- five-argument calls ambiguous). The backend is updated in the same change.
-- squawk-ignore ban-drop-function
DROP FUNCTION IF EXISTS log_contact(UUID, UUID, TIMESTAMPTZ, BOOLEAN, TEXT);

-- A null p_is_follow_up means "a follow-up if they are a new contact".
CREATE FUNCTION log_contact(
    p_person_id UUID,
    p_user_id UUID,
    p_contacted_at TIMESTAMPTZ DEFAULT now(),
    p_is_follow_up BOOLEAN DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_prayer_burden TEXT DEFAULT NULL
)
RETURNS CONTACT_LOG AS $$
DECLARE
    result      contact_log;
    status_name VARCHAR;
    v_note      TEXT := NULLIF(btrim(p_note), '');
    v_burden    TEXT := NULLIF(btrim(p_prayer_burden), '');
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

    INSERT INTO contact_log (person_id, user_id, contacted_at, is_follow_up)
    VALUES (
        p_person_id,
        p_user_id,
        COALESCE(p_contacted_at, now()),
        COALESCE(p_is_follow_up, status_name = 'new contact')
    )
    RETURNING * INTO result;

    IF v_note IS NOT NULL THEN
        INSERT INTO comment (user_id, person_id, content, contact_log_id)
        VALUES (p_user_id, p_person_id, v_note, result.id);
    END IF;

    IF v_burden IS NOT NULL THEN
        INSERT INTO prayer_burden (person_id, content, contact_log_id)
        VALUES (p_person_id, v_burden, result.id);
    END IF;

    IF result.is_follow_up AND status_name = 'new contact' THEN
        UPDATE person
        SET status_id = (SELECT id FROM status WHERE name = 'active')
        WHERE id = p_person_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

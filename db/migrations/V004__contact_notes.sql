-- ============================================================
-- Shepherd My Sheep — Contact notes become comments
-- ============================================================
--
-- A note written when logging a contact is a standalone comment on the
-- person (business rule 5), linked to that contact, so every note lives in
-- one place. Undoing the contact (delete_contact) removes its note too.
-- This replaces contact_log.note.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE comment ADD COLUMN IF NOT EXISTS contact_log_id UUID;

-- Added unvalidated, then validated, so the check doesn't block writes.
-- Dropped first so the migration can be rerun; it only ever drops the
-- constraint added just below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE comment DROP CONSTRAINT IF EXISTS comment_contact_log_id_fkey;

ALTER TABLE comment
ADD CONSTRAINT comment_contact_log_id_fkey
FOREIGN KEY (contact_log_id) REFERENCES contact_log (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE comment VALIDATE CONSTRAINT comment_contact_log_id_fkey;

-- comment is small before launch, and CONCURRENTLY can't run inside the
-- single transaction tests apply this in.
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_contact_log ON comment (contact_log_id)
WHERE contact_log_id IS NOT NULL;

-- Keep existing contact notes as comments. A note whose author is unknown
-- or deleted is dropped, as comments already go with their author.
INSERT INTO comment (user_id, person_id, content, contact_log_id, created_at, updated_at)
SELECT
    cl.user_id,
    cl.person_id,
    cl.note,
    cl.id,
    cl.contacted_at AS created_at,
    cl.contacted_at AS updated_at
FROM contact_log AS cl
WHERE cl.user_id IS NOT NULL AND nullif(btrim(cl.note), '') IS NOT NULL;

-- Its data now lives in comment (copied above).
-- squawk-ignore ban-drop-column
ALTER TABLE contact_log DROP COLUMN IF EXISTS note;

-- Same signature as V003; a non-blank note is now saved as a comment by
-- the contactor. A follow-up on a 'new contact' still makes them 'active'.
CREATE OR REPLACE FUNCTION log_contact(
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
    v_note      TEXT := NULLIF(btrim(p_note), '');
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
    VALUES (p_person_id, p_user_id, COALESCE(p_contacted_at, now()), COALESCE(p_is_follow_up, false))
    RETURNING * INTO result;

    IF v_note IS NOT NULL THEN
        INSERT INTO comment (user_id, person_id, content, contact_log_id)
        VALUES (p_user_id, p_person_id, v_note, result.id);
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

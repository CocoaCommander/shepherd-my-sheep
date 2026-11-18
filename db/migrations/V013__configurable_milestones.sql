-- ============================================================
-- Shepherd My Sheep — Configurable milestones
-- ============================================================
--
-- The milestone list was fixed at the four V001 seeds. It becomes one
-- shared, editable list (business rule 7): any signed-in user may add,
-- rename or delete a milestone, and the list may be empty.
--
-- Deleting is a soft delete (deleted_at) so the web's Undo can bring back
-- every person's record of the milestone: the milestone_person rows are
-- left untouched while it is hidden. Restore is allowed for an hour. Each
-- delete first purges milestones deleted more than an hour ago, and the
-- ON DELETE CASCADE then removes their records, so no scheduler is needed.
--
-- Names are unique among live milestones, ignoring case. The resolver
-- trims and length-checks names and descriptions with user-facing
-- messages; the CHECKs here are the guard behind it.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ── Table ───────────────────────────────────────────────────

-- Null while the milestone is live.
ALTER TABLE milestone ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The V001 UNIQUE is case-sensitive and counts deleted milestones, so a
-- deleted name could never be reused. It is replaced by a partial index
-- on lower(name).
-- squawk-ignore ban-drop-constraint
ALTER TABLE milestone DROP CONSTRAINT IF EXISTS milestone_name_key;

-- milestone holds a handful of rows, and CONCURRENTLY can't run inside
-- the single transaction tests apply this in.
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX IF NOT EXISTS milestone_live_name_key ON milestone (lower(name))
WHERE deleted_at IS NULL;

-- Added unvalidated, then validated, so the checks don't block writes.
-- The seeds already satisfy them. char_length counts characters, as the
-- resolver does. VARCHAR(100) already caps the name; the check also
-- rejects empty and untrimmed names. Each is dropped first so the
-- migration can be rerun; that only ever drops the constraint added here.
-- squawk-ignore ban-drop-constraint
ALTER TABLE milestone DROP CONSTRAINT IF EXISTS milestone_name_trimmed;

ALTER TABLE milestone
ADD CONSTRAINT milestone_name_trimmed
CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE milestone VALIDATE CONSTRAINT milestone_name_trimmed;

-- Never an empty string: no description is null.
-- squawk-ignore ban-drop-constraint
ALTER TABLE milestone DROP CONSTRAINT IF EXISTS milestone_description_trimmed;

ALTER TABLE milestone
ADD CONSTRAINT milestone_description_trimmed
CHECK (
    description IS NULL
    OR (description = btrim(description) AND char_length(description) BETWEEN 1 AND 1000)
) NOT VALID;

ALTER TABLE milestone VALIDATE CONSTRAINT milestone_description_trimmed;

-- ── The shared list ─────────────────────────────────────────

-- A duplicate name (ignoring case) raises unique_violation.
CREATE OR REPLACE FUNCTION create_milestone(
    p_name VARCHAR,
    p_description TEXT DEFAULT NULL
)
RETURNS MILESTONE AS $$
DECLARE
    result milestone;
BEGIN
    INSERT INTO milestone (name, description)
    VALUES (p_name, p_description)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- A null argument leaves the field unchanged; p_clear_description empties
-- the description (V011 pattern). The flag together with a value is a
-- caller bug, and raises. A deleted milestone can't be edited.
CREATE OR REPLACE FUNCTION update_milestone(
    p_id UUID,
    p_name VARCHAR DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE
)
RETURNS MILESTONE AS $$
DECLARE
    result milestone;
BEGIN
    IF p_clear_description AND p_description IS NOT NULL THEN
        RAISE EXCEPTION 'Description can''t be both set and cleared'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    UPDATE milestone SET
        name        = COALESCE(p_name, name),
        description = CASE WHEN p_clear_description THEN NULL
                           ELSE COALESCE(p_description, description) END
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Hides the milestone and every record of it. Milestones deleted over an
-- hour ago are purged first; the cascade removes their records.
CREATE OR REPLACE FUNCTION delete_milestone(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Locked in id order first, so two deletes purging at once can't deadlock.
    PERFORM 1 FROM milestone
    WHERE deleted_at < now() - INTERVAL '1 hour'
    ORDER BY id
    FOR UPDATE;
    DELETE FROM milestone WHERE deleted_at < now() - INTERVAL '1 hour';

    UPDATE milestone SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found: %', p_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Undo of delete_milestone, within the hour. Raises unique_violation if
-- another live milestone has taken the name since.
CREATE OR REPLACE FUNCTION restore_milestone(p_id UUID)
RETURNS MILESTONE AS $$
DECLARE
    result milestone;
BEGIN
    UPDATE milestone SET deleted_at = NULL
    WHERE id = p_id AND deleted_at >= now() - INTERVAL '1 hour'
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deleted milestone not found: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── Recording one for a person ──────────────────────────────

-- The V002 bodies, refusing a deleted milestone. FOR SHARE makes a
-- concurrent delete wait, so a record can't slip in under a milestone
-- that is being hidden.
CREATE OR REPLACE FUNCTION record_milestone(
    p_person_id UUID,
    p_milestone_id UUID,
    p_recorded_by UUID,
    p_date_achieved DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS MILESTONE_PERSON AS $$
DECLARE
    result milestone_person;
BEGIN
    PERFORM 1 FROM milestone
    WHERE id = p_milestone_id AND deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found: %', p_milestone_id;
    END IF;

    INSERT INTO milestone_person (person_id, milestone_id, recorded_by, date_achieved, notes)
    VALUES (p_person_id, p_milestone_id, p_recorded_by, p_date_achieved, p_notes)
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- A hidden record can't be removed: it comes back on restore as it was.
CREATE OR REPLACE FUNCTION remove_milestone(
    p_person_id UUID,
    p_milestone_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    PERFORM 1 FROM milestone
    WHERE id = p_milestone_id AND deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found: %', p_milestone_id;
    END IF;

    DELETE FROM milestone_person
    WHERE person_id = p_person_id AND milestone_id = p_milestone_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone record not found for person % and milestone %', p_person_id, p_milestone_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

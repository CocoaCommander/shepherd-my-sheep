-- ============================================================
-- Shepherd My Sheep — Prayer log
-- ============================================================
--
-- A record each time a shepherd prays for a person, so every shepherd of
-- that person can see when they were last prayed for, and by whom.
--
-- A record belongs to the person, not to a prayer burden: someone with no
-- burdens can still be prayed for (business rule 3). Each record is its
-- own row; praying twice in a day is two records.
--
-- Praying is not a contact. Nothing here touches contact_log, the status
-- or person_contact_state (business rule 6).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS prayer_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id UUID NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    -- Who prayed; null if the user was deleted (their records stay). "user" is reserved, so it stays quoted.
    user_id UUID REFERENCES "user" (id) ON DELETE SET NULL,  -- noqa: RF06
    -- When they prayed; earlier than created_at for a back-dated record.
    prayed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The table was created just above and is empty, so nothing is blocked.
-- (CONCURRENTLY can't run inside the single transaction tests apply this in.)
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_prayer_log_person ON prayer_log (person_id, prayed_at DESC);

-- ── Prayers ─────────────────────────────────────────────────

-- A null time means now. Back-dating is allowed; the future is not.
CREATE OR REPLACE FUNCTION record_prayer(
    p_person_id UUID,
    p_user_id UUID,
    p_prayed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS PRAYER_LOG AS $$
DECLARE
    result prayer_log;
BEGIN
    PERFORM 1 FROM person WHERE id = p_person_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_person_id;
    END IF;

    -- A little slack for clocks that disagree.
    IF p_prayed_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'Prayer time is in the future'
            USING ERRCODE = 'check_violation';
    END IF;

    -- '-infinity' isn't a time anyone prayed, and clients can't parse it.
    IF NOT isfinite(p_prayed_at) THEN
        RAISE EXCEPTION 'Prayer time is not a real time'
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO prayer_log (person_id, user_id, prayed_at)
    VALUES (p_person_id, p_user_id, COALESCE(p_prayed_at, now()))
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Removes a prayer record (e.g. Undo).
CREATE OR REPLACE FUNCTION delete_prayer(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM prayer_log WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prayer not found: %', p_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

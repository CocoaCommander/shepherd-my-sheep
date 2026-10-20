-- ============================================================
-- Shepherd My Sheep — Undo a prayer-burden release
-- ============================================================
--
-- Releasing a burden (answered or closed) was one-way. The Prayer list's
-- Undo toast and the Recently released panel need to put it back on the
-- active list. Any shepherd of the person may do it, at any time; the
-- resolver checks who the caller shepherds, as it does for release.
--
-- created_at is kept, so "added N ago" still counts from when the burden
-- was first added. Comments stay linked: releasing never touched them.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ── Prayer Burdens ──────────────────────────────────────────

-- The mirror of release_prayer_burden (V002). Raises (P0001, mapped to
-- NOT_FOUND) for an unknown id or a burden that isn't released, as
-- releasing twice does.
CREATE OR REPLACE FUNCTION unrelease_prayer_burden(p_id UUID)
RETURNS PRAYER_BURDEN AS $$
DECLARE
    result prayer_burden;
BEGIN
    UPDATE prayer_burden
    SET released_date = NULL
    WHERE id = p_id AND released_date IS NOT NULL
    RETURNING * INTO result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prayer burden not found or not released: %', p_id;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Don't leave the timeouts set on the session that ran this.
RESET statement_timeout;
RESET lock_timeout;

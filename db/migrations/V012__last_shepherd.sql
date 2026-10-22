-- ============================================================
-- Shepherd My Sheep — A person keeps at least one shepherd
-- ============================================================
--
-- People are visible only to their shepherds, so a person with none is
-- visible to no one. "Can't remove the last shepherd" was enforced only in
-- the unassignPerson resolver; any other DELETE on user_person could still
-- strand a person. This trigger moves the rule into the database, for every
-- path.
--
-- Only removal is guarded: a person may be created with no shepherd
-- (createPerson assigns one in the same transaction). Deleting the person is
-- always allowed, and is the way out: the cascade removes the links after
-- the person row is gone, so the trigger finds no person and lets it pass.
-- Deleting a user who is the last shepherd of someone is refused (via the
-- cascade); their people must be deleted or handed to another shepherd first.
--
-- AFTER ... FOR EACH ROW sees every row a statement removed, so a DELETE
-- that removes all of a person's links at once is caught too. Locking the
-- person serialises two transactions removing different shepherds: the
-- second waits, then (READ COMMITTED) its count sees the first's delete.
--
-- Raises check_violation (23514), which nothing else on this path raises,
-- so the resolver can match it and raw-SQL callers get a client error.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION keep_last_shepherd()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1 FROM person WHERE id = OLD.person_id FOR UPDATE;
    IF NOT FOUND THEN
        -- The person is being deleted: the links go with it.
        RETURN NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM user_person WHERE person_id = OLD.person_id) THEN
        RAISE EXCEPTION 'A person needs at least one shepherd'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_user_person_keep_last_shepherd
AFTER DELETE ON user_person
FOR EACH ROW EXECUTE FUNCTION keep_last_shepherd();

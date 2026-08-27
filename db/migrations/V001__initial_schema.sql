-- ============================================================
-- Shepherd My Sheep — Initial Schema
-- PostgreSQL 15+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Lookup / reference tables
-- ============================================================

CREATE TABLE status (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(50) NOT NULL UNIQUE,   -- e.g. 'active', 'inactive', 'new contact'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE milestone (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,  -- e.g. 'baptised', 'joined small group'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Core tables
-- ============================================================

CREATE TABLE "user" (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,         -- bcrypt / argon2 output
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE person (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100) NOT NULL,
    age                 INT,
    year_met            INT,                        -- calendar year contact was made
    last_contact_date   DATE,                       -- replaces "year(s) lost contact"
    is_active           BOOLEAN NOT NULL DEFAULT true,
    status_id           UUID NOT NULL REFERENCES status(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Junction / relationship tables
-- ============================================================

-- Which users are shepherding which people (many-to-many)
CREATE TABLE user_person (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    person_id   UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, person_id)
);

-- Which milestones a person has reached, with context
CREATE TABLE milestone_person (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id       UUID NOT NULL REFERENCES person(id)  ON DELETE CASCADE,
    milestone_id    UUID NOT NULL REFERENCES milestone(id) ON DELETE CASCADE,
    date_achieved   DATE,                           -- when the person reached it
    notes           TEXT,                            -- optional context
    recorded_by     UUID REFERENCES "user"(id) ON DELETE SET NULL,  -- who logged it
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (person_id, milestone_id)
);

-- ============================================================
-- Prayer burdens & comments
-- ============================================================

-- A prayer burden is always tied to a person.
-- It can exist on its own (direct assignment) or be linked from a comment.
CREATE TABLE prayer_burden (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id       UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    released_date   TIMESTAMPTZ,                    -- NULL = still active; set = released
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A comment is always about a person.
-- It may optionally reference a prayer burden it spawned or discusses.
CREATE TABLE comment (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    person_id           UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    prayer_burden_id    UUID REFERENCES prayer_burden(id) ON DELETE SET NULL,  -- nullable
    content             TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Fast lookups for the most common access patterns
CREATE INDEX idx_user_person_user     ON user_person(user_id);
CREATE INDEX idx_user_person_person   ON user_person(person_id);

CREATE INDEX idx_milestone_person_person    ON milestone_person(person_id);
CREATE INDEX idx_milestone_person_milestone ON milestone_person(milestone_id);

CREATE INDEX idx_prayer_burden_person ON prayer_burden(person_id);
CREATE INDEX idx_prayer_burden_active ON prayer_burden(person_id) WHERE released_date IS NULL;

CREATE INDEX idx_comment_person       ON comment(person_id);
CREATE INDEX idx_comment_prayer       ON comment(prayer_burden_id) WHERE prayer_burden_id IS NOT NULL;
CREATE INDEX idx_comment_user         ON comment(user_id);

CREATE INDEX idx_person_status        ON person(status_id);

-- ============================================================
-- Updated-at trigger (auto-set updated_at on any UPDATE)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to every table that has updated_at
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'status', 'milestone',
            '"user"', 'person',
            'milestone_person',
            'prayer_burden', 'comment'
        ])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            replace(replace(tbl, '"', ''), '.', '_'),
            tbl
        );
    END LOOP;
END;
$$;

-- ============================================================
-- Seed data — default lookup values
-- ============================================================

INSERT INTO status (name) VALUES
    ('new contact'),
    ('active'),
    ('inactive'),
    ('lost contact');

INSERT INTO milestone (name, description) VALUES
    ('baptised',           'Person has been baptised'),
    ('joined small group', 'Person is attending a small group regularly'),
    ('serving',            'Person is serving in a ministry'),
    ('leading',            'Person is leading a group or ministry');

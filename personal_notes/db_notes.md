# Database Design Decisions

## Stored Procedures for Writes, Plain Queries for Reads

**Decision:** Write operations (create, update, delete) use PostgreSQL stored procedures.
Read operations use plain SQL queries in the GraphQL resolvers.

**Why this combo:**

- **Writes have business rules** — creating a person, recording a milestone, linking a
  comment to a prayer burden all involve validation and constraints. Putting these in
  stored procedures means the logic lives in one place (the DB), and both the C++ app
  and the pytest suite call the exact same code path.

- **Reads are simple and flexible** — GraphQL lets the client request different field
  combinations per query. If reads were locked behind stored procedures, we'd need a
  procedure for every field combination or return everything and waste bandwidth. Plain
  queries in the resolvers let us build SQL dynamically based on what the client asked for.

- **Tests validate the real path** — tests call the same stored procedures the app calls.
  If a procedure has a bug, the test catches it. No risk of tests passing on raw SQL
  while the app fails on a different code path.

- **Tradeoff accepted** — migrations are heavier because procedure changes need new
  migration files. We accept this because write logic changes less often than read
  patterns, and having a single source of truth for writes is worth the migration cost.

## Stored Procedures We Have

| Procedure | Purpose |
|---|---|
| `create_user` | Register a new user |
| `create_person` | Add a new person being shepherded |
| `update_person` | Update person details |
| `delete_person` | Remove a person (cascades handled by FK constraints) |
| `assign_person` | Link a user to a person (shepherding relationship) |
| `unassign_person` | Remove a user-person link; a person's last link can't be removed |
| `record_milestone` | Mark a milestone as achieved for a person |
| `remove_milestone` | Remove a milestone record from a person |
| `create_prayer_burden` | Add a prayer burden for a person |
| `release_prayer_burden` | Mark a prayer burden as released |
| `create_comment` | Add a comment (standalone or linked to a prayer burden) |
| `delete_comment` | Remove a comment |

## Triggers

| Trigger | Purpose |
|---|---|
| `trg_user_person_keep_last_shepherd` | AFTER DELETE FOR EACH ROW on `user_person`; runs `keep_last_shepherd()` |

`keep_last_shepherd()` raises `check_violation` (23514) "A person needs at least one
shepherd" when a delete would leave an existing person with no shepherds. It locks the
person row first, so concurrent removals serialise.

- Deleting the person is always allowed: the cascade runs after the person row is gone.
- Deleting a user who is someone's last shepherd is refused; hand their people over or
  delete them first.
- Only removal is guarded; a person can still be created with no shepherd.

#pragma once

#include "../../db/DatabasePool.hpp"
#include "../../models/DTOs.hpp"
#include "../../auth/PasswordHasher.hpp"
#include "../../auth/JWTService.hpp"
#include "../../middleware/RateLimiter.hpp"
#include "ResolverSupport.hpp"

#include <pqxx/pqxx>
#include <memory>
#include <string>

/**
 * Handles GraphQL mutation operations (writes).
 *
 * All writes go through PostgreSQL stored procedures so the app
 * and tests exercise the exact same code path. Password hashing is the
 * one thing deliberately kept out of the database — see PasswordHasher.
 *
 * Apart from register and login (see isPublic), every mutation runs
 * as the user in the access token. The acting user is never taken from
 * the request variables, and each person-scoped write first checks
 * requireShepherd() inside the same transaction.
 */
class MutationResolver {
public:
    // Short enough to type on a phone, long enough that the argon2 cost
    // is not the only thing slowing down a guesser.
    static constexpr size_t MIN_PASSWORD_LENGTH = 8;

    MutationResolver(std::shared_ptr<DatabasePool> dbPool, std::shared_ptr<JWTService> jwtService,
                     std::shared_ptr<RateLimits> rateLimits)
        : m_dbPool(std::move(dbPool)), m_jwt(std::move(jwtService)), m_rateLimits(std::move(rateLimits)) {}

    /** Mutations that run without an access token. */
    static bool isPublic(const std::string& field) {
        return field == "register" || field == "login";
    }

    /** `userId` is empty only for isPublic() mutations. */
    oatpp::Any resolve(const std::string& field, const Args& args, const std::string& userId) {
        if (field == "register") return resolveRegister(args);
        if (field == "login") return resolveLogin(args);
        if (field == "createPerson") return resolveCreatePerson(args, userId);
        if (field == "updatePerson") return resolveUpdatePerson(args, userId);
        if (field == "undoStatusChange") return resolveUndoStatusChange(args, userId);
        if (field == "deletePerson") return resolveDeletePerson(args, userId);
        if (field == "assignPerson") return resolveAssignPerson(args, userId);
        if (field == "unassignPerson") return resolveUnassignPerson(args, userId);
        if (field == "recordMilestone") return resolveRecordMilestone(args, userId);
        if (field == "removeMilestone") return resolveRemoveMilestone(args, userId);
        if (field == "createPrayerBurden") return resolveCreatePrayerBurden(args, userId);
        if (field == "releasePrayerBurden") return resolveReleasePrayerBurden(args, userId);
        if (field == "unreleasePrayerBurden") return resolveUnreleasePrayerBurden(args, userId);
        if (field == "createComment") return resolveCreateComment(args, userId);
        if (field == "deleteComment") return resolveDeleteComment(args, userId);
        if (field == "logContact") return resolveLogContact(args, userId);
        if (field == "deleteContact") return resolveDeleteContact(args, userId);
        if (field == "recordPrayer") return resolveRecordPrayer(args, userId);
        if (field == "deletePrayer") return resolveDeletePrayer(args, userId);

        throw BadInput("Unknown mutation: " + field);
    }

private:
    std::shared_ptr<DatabasePool> m_dbPool;
    std::shared_ptr<JWTService>   m_jwt;
    std::shared_ptr<RateLimits>   m_rateLimits;

    oatpp::Object<AuthPayloadDto> authPayload(const pqxx::row& userRow) {
        auto payload   = AuthPayloadDto::createShared();
        payload->token = m_jwt->issue(userRow["id"].c_str()).c_str();
        payload->user  = rowToUser(userRow);
        return payload;
    }

    // ── Auth ────────────────────────────────────────────────

    oatpp::Any resolveRegister(const Args& args) {
        auto input    = args.object("input");
        auto name     = input.req("name");
        auto username = input.req("username");
        auto password = input.req("password");

        if (name.empty() || username.empty()) {
            throw BadInput("Name and username are required");
        }
        if (password.size() < MIN_PASSWORD_LENGTH) {
            throw BadInput("Password must be at least " + std::to_string(MIN_PASSWORD_LENGTH) + " characters");
        }

        // Hashed here, never in the database: a pgcrypto crypt() call would
        // put the plaintext on the wire and into pg_stat_statements.
        std::string passwordHash = PasswordHasher::hash(password);

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        pqxx::result result;
        try {
            result = txn.exec_params("SELECT * FROM create_user($1, $2, $3)", name, username, passwordHash);
        } catch (const pqxx::unique_violation&) {
            throw Conflict("Username is already taken");
        }
        txn.commit();

        return authPayload(result[0]);
    }

    oatpp::Any resolveLogin(const Args& args) {
        auto input    = args.object("input");
        auto username = input.req("username");
        auto password = input.req("password");

        // Before the lookup and any argon2 work; known and unknown
        // usernames back off alike.
        m_rateLimits->checkLogin(username);

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec_params("SELECT * FROM \"user\" WHERE username = $1", username);
        txn.commit();

        if (result.empty()) {
            // Spend the same time a real verify would before failing, so
            // response latency does not reveal which usernames exist.
            PasswordHasher::dummyVerify(password);
            m_rateLimits->loginFailed(username);
            throw BadInput("Invalid username or password");
        }

        std::string storedHash = result[0]["password_hash"].c_str();

        if (!PasswordHasher::verify(storedHash, password)) {
            // Identical message to the branch above — never distinguish
            // "no such user" from "wrong password" to the caller.
            m_rateLimits->loginFailed(username);
            throw BadInput("Invalid username or password");
        }
        m_rateLimits->loginSucceeded(username);

        // The plaintext is only in hand during login, so this is the one
        // chance to upgrade a hash stored under weaker cost parameters.
        //
        // Best-effort: the credentials are already verified, so a busy
        // server must not turn a good login into a failure. We just skip
        // the upgrade and try again on the next sign-in.
        if (PasswordHasher::needsRehash(storedHash)) {
            try {
                pqxx::work rehashTxn(*conn);
                rehashTxn.exec_params("UPDATE \"user\" SET password_hash = $1 WHERE id = $2",
                                      PasswordHasher::hash(password), result[0]["id"].c_str());
                rehashTxn.commit();
            } catch (const PasswordHasher::Busy&) {
                // No hash slot free — leave the old hash in place.
            }
        }

        return authPayload(result[0]);
    }

    // ── Person ──────────────────────────────────────────────

    /** A person's name, trimmed; it must not be blank. */
    static std::string requireName(const std::string& name) {
        if (isBlank(name)) throw BadInput("Name must not be blank");
        return trim(name);
    }

    /**
     * The creator becomes the person's first shepherd in the same
     * transaction; otherwise the new person would be visible to no one.
     * An optional comment is saved as the creator's standalone note.
     * Age and year met are range-checked by the database (check_violation).
     */
    oatpp::Any resolveCreatePerson(const Args& args, const std::string& userId) {
        auto input    = args.object("input");
        auto name     = requireName(input.req("name"));
        auto statusId = input.req("statusId");
        auto age      = input.opt("age");
        auto yearMet  = input.opt("yearMet");
        auto comment  = input.opt("comment");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto created = txn.exec_params("SELECT id FROM create_person($1, $2::uuid, $3::int, $4::int)", name, statusId,
                                       nullable(age), nullable(yearMet));
        std::string personId = created[0]["id"].c_str();

        txn.exec_params("SELECT * FROM assign_person($1, $2)", userId, personId);

        if (comment && !isBlank(*comment)) {
            txn.exec_params("SELECT id FROM create_comment($1, $2, $3)", userId, personId, trim(*comment));
        }

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    /**
     * Only the fields present in `input` change; `age: null` / `yearMet: null`
     * clears them. The other fields can't be empty, so null is rejected.
     */
    oatpp::Any resolveUpdatePerson(const Args& args, const std::string& userId) {
        auto id    = args.req("id");
        auto input = args.object("input");
        if (input.isNull("name")) throw BadInput("Name can't be cleared");
        if (input.isNull("isActive")) throw BadInput("Active can't be cleared");
        if (input.isNull("statusId")) throw BadInput("Status can't be cleared");
        auto name = input.opt("name");
        if (name) name = requireName(*name);

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, id);

        txn.exec_params("SELECT * FROM update_person("
                        "p_id                := $1::uuid, "
                        "p_name              := $2::varchar, "
                        "p_age               := $3::int, "
                        "p_year_met          := $4::int, "
                        "p_is_active         := $5::boolean, "
                        "p_status_id         := $6::uuid, "
                        "p_clear_age         := $7::boolean, "
                        "p_clear_year_met    := $8::boolean)",
                        id, nullable(name), nullable(input.opt("age")), nullable(input.opt("yearMet")),
                        nullable(input.opt("isActive")), nullable(input.opt("statusId")), input.isNull("age"),
                        input.isNull("yearMet"));

        auto person = fetchPersonDetail(txn, id);
        txn.commit();
        return person;
    }

    /**
     * Undo of a status move (the board's toast). The client names the move
     * by the status it set and the stamp it got; the server puts back the
     * status and stamp from before it, so the contact clock doesn't restart
     * (business rule 6). CONFLICT if the person has moved, been promoted by
     * a contact or been reverted since, or was never moved.
     */
    oatpp::Any resolveUndoStatusChange(const Args& args, const std::string& userId) {
        auto personId        = args.req("personId");
        auto statusId        = args.req("statusId");
        auto statusChangedAt = args.req("statusChangedAt");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        // Read first: a failed revert aborts the transaction.
        std::string name = txn.exec_params("SELECT name FROM person WHERE id = $1", personId)[0]["name"].c_str();
        try {
            txn.exec_params("SELECT 1 FROM revert_status_change($1::uuid, $2::uuid, $3::timestamptz)", personId,
                            statusId, statusChangedAt);
        } catch (const pqxx::sql_error& e) {
            if (e.sqlstate() != "55000") throw;
            throw Conflict(name + "'s status has changed since");
        }

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    oatpp::Any resolveDeletePerson(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, id);

        txn.exec_params("SELECT * FROM delete_person($1)", id);
        txn.commit();

        return oatpp::Boolean(true);
    }

    // ── Assignment ──────────────────────────────────────────

    /** Any current shepherd may add another user as a shepherd. */
    oatpp::Any resolveAssignPerson(const Args& args, const std::string& userId) {
        auto personId = args.req("personId");
        auto targetId = args.req("userId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        try {
            txn.exec_params("SELECT * FROM assign_person($1, $2)", targetId, personId);
        } catch (const pqxx::unique_violation&) {
            throw Conflict("User is already assigned to this person");
        } catch (const pqxx::foreign_key_violation&) {
            throw NotFound("User not found");
        }

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    /**
     * Any current shepherd may remove a shepherd, including themselves, but
     * never the last one: a person with no shepherds is visible to no one.
     */
    oatpp::Any resolveUnassignPerson(const Args& args, const std::string& userId) {
        auto personId = args.req("personId");
        auto targetId = args.req("userId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        // Locking the person serialises concurrent unassigns, so two
        // shepherds removing each other can't both pass the count below. It
        // comes first so the shepherd check sees any removal of the caller
        // that committed while we waited.
        txn.exec_params("SELECT 1 FROM person WHERE id = $1 FOR UPDATE", personId);
        requireShepherd(txn, userId, personId);
        auto shepherds = txn.exec_params("SELECT count(*) FROM user_person WHERE person_id = $1", personId);
        auto target =
            txn.exec_params("SELECT 1 FROM user_person WHERE person_id = $1 AND user_id = $2", personId, targetId);
        if (!target.empty() && shepherds[0][0].as<int>() <= 1) {
            throw BadInput("A person needs at least one shepherd. Delete them instead.");
        }

        txn.exec_params("SELECT * FROM unassign_person($1, $2)", targetId, personId);

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    // ── Milestones ──────────────────────────────────────────

    oatpp::Any resolveRecordMilestone(const Args& args, const std::string& userId) {
        auto input        = args.object("input");
        auto personId     = input.req("personId");
        auto milestoneId  = input.req("milestoneId");
        auto dateAchieved = input.opt("dateAchieved");
        auto notes        = input.opt("notes");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        pqxx::result created;
        try {
            created = txn.exec_params("SELECT id FROM record_milestone($1, $2, $3, $4::date, $5)", personId,
                                      milestoneId, userId, nullable(dateAchieved), nullable(notes));
        } catch (const pqxx::unique_violation&) {
            throw Conflict("Milestone is already recorded for this person");
        }

        auto result =
            txn.exec_params(std::string(MILESTONE_PERSON_SELECT) + "WHERE mp.id = $1", created[0]["id"].c_str());
        txn.commit();

        return rowToMilestonePerson(result[0]);
    }

    oatpp::Any resolveRemoveMilestone(const Args& args, const std::string& userId) {
        auto personId    = args.req("personId");
        auto milestoneId = args.req("milestoneId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        txn.exec_params("SELECT * FROM remove_milestone($1, $2)", personId, milestoneId);
        txn.commit();

        return oatpp::Boolean(true);
    }

    // ── Prayer Burdens ──────────────────────────────────────

    oatpp::Any resolveCreatePrayerBurden(const Args& args, const std::string& userId) {
        auto input    = args.object("input");
        auto personId = input.req("personId");
        auto content  = input.req("content");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        auto result = txn.exec_params("SELECT id FROM create_prayer_burden($1, $2)", personId, content);
        auto burden = fetchBurden(txn, result[0]["id"].c_str());
        txn.commit();

        return burden;
    }

    oatpp::Any resolveReleasePrayerBurden(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto owner = txn.exec_params("SELECT person_id FROM prayer_burden WHERE id = $1", id);
        if (owner.empty() || !isShepherd(txn, userId, owner[0]["person_id"].c_str())) {
            throw NotFound("Prayer burden not found");
        }

        txn.exec_params("SELECT 1 FROM release_prayer_burden($1)", id);
        auto burden = fetchBurden(txn, id);
        txn.commit();

        return burden;
    }

    /** Undo of a release: any shepherd of the person, at any time. */
    oatpp::Any resolveUnreleasePrayerBurden(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto owner = txn.exec_params("SELECT person_id FROM prayer_burden WHERE id = $1", id);
        if (owner.empty() || !isShepherd(txn, userId, owner[0]["person_id"].c_str())) {
            throw NotFound("Prayer burden not found");
        }

        txn.exec_params("SELECT 1 FROM unrelease_prayer_burden($1)", id);
        auto burden = fetchBurden(txn, id);
        txn.commit();

        return burden;
    }

    // ── Comments ────────────────────────────────────────────

    oatpp::Any resolveCreateComment(const Args& args, const std::string& userId) {
        auto input          = args.object("input");
        auto personId       = input.req("personId");
        auto content        = input.req("content");
        auto prayerBurdenId = input.opt("prayerBurdenId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        // A comment may link to a burden (business rule 5), but only to
        // one of the same person's — never to someone else's.
        if (prayerBurdenId) {
            auto burden = txn.exec_params("SELECT 1 FROM prayer_burden WHERE id = $1 AND person_id = $2",
                                          *prayerBurdenId, personId);
            if (burden.empty()) {
                throw NotFound("Prayer burden not found");
            }
        }

        auto created = txn.exec_params("SELECT id FROM create_comment($1, $2, $3, $4::uuid)", userId, personId, content,
                                       nullable(prayerBurdenId));

        auto result = txn.exec_params(std::string(COMMENT_SELECT) + "WHERE c.id = $1", created[0]["id"].c_str());
        txn.commit();

        return rowToComment(result[0]);
    }

    /** Only the comment's author may delete it. */
    oatpp::Any resolveDeleteComment(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto owner = txn.exec_params("SELECT 1 FROM comment WHERE id = $1 AND user_id = $2", id, userId);
        if (owner.empty()) {
            throw NotFound("Comment not found");
        }

        txn.exec_params("SELECT * FROM delete_comment($1)", id);
        txn.commit();

        return oatpp::Boolean(true);
    }

    // ── Contacts ────────────────────────────────────────────

    /**
     * Records that the caller made contact (business rule 6), from the
     * "Log contact" modal: a date and a note are required, a prayer burden
     * is optional. Contact for a 'new contact' is their follow-up and moves
     * them to 'active' in the same transaction. Returns the person so the
     * client gets the new contact state.
     */
    oatpp::Any resolveLogContact(const Args& args, const std::string& userId) {
        auto input        = args.object("input");
        auto personId     = input.req("personId");
        auto contactedAt  = input.req("contactedAt");
        auto note         = input.req("note");
        auto prayerBurden = input.opt("prayerBurden");
        // isFollowUp is deprecated and ignored.

        if (isBlank(note)) {
            throw BadInput("Note must not be blank");
        }

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        // A null follow-up flag lets log_contact decide from the person's status.
        txn.exec_params("SELECT * FROM log_contact($1::uuid, $2::uuid, $3::timestamptz, NULL, $4, $5)", personId,
                        userId, contactedAt, note, nullable(prayerBurden));

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    /** Any shepherd of the person may remove a logged contact, e.g. to undo a mistake. */
    oatpp::Any resolveDeleteContact(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto owner = txn.exec_params("SELECT person_id FROM contact_log WHERE id = $1", id);
        if (owner.empty() || !isShepherd(txn, userId, owner[0]["person_id"].c_str())) {
            throw NotFound("Contact not found");
        }
        std::string personId = owner[0]["person_id"].c_str();

        txn.exec_params("SELECT * FROM delete_contact($1)", id);

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    // ── Prayers ─────────────────────────────────────────────

    /**
     * Records that the caller prayed for the person, now or at an earlier
     * `prayedAt` (back-dated). Not a contact: the contact state is
     * unchanged. Returns the person with the new last prayer and history.
     */
    oatpp::Any resolveRecordPrayer(const Args& args, const std::string& userId) {
        auto personId = args.req("personId");
        auto prayedAt = args.opt("prayedAt");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);
        requireShepherd(txn, userId, personId);

        // A null time lets record_prayer use now().
        txn.exec_params("SELECT * FROM record_prayer($1::uuid, $2::uuid, $3::timestamptz)", personId, userId,
                        nullable(prayedAt));

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    /**
     * Only the shepherd who recorded a prayer may delete it (Undo), and only
     * while they still shepherd the person. Anyone else gets the same
     * NOT_FOUND as for a missing record.
     */
    oatpp::Any resolveDeletePrayer(const Args& args, const std::string& userId) {
        auto id = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto owner = txn.exec_params("SELECT person_id FROM prayer_log WHERE id = $1 AND user_id = $2", id, userId);
        if (owner.empty() || !isShepherd(txn, userId, owner[0]["person_id"].c_str())) {
            throw NotFound("Prayer not found");
        }
        std::string personId = owner[0]["person_id"].c_str();

        txn.exec_params("SELECT * FROM delete_prayer($1)", id);

        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }
};

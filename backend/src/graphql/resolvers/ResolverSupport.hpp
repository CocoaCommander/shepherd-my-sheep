#pragma once

#include "../../models/DTOs.hpp"

#include <pqxx/pqxx>

#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>

/**
 * Pieces shared by QueryResolver and MutationResolver: reading GraphQL
 * arguments, mapping rows to DTOs, and the ownership check every
 * person-scoped operation runs.
 */

/** No valid token on an operation that needs one. Mapped to HTTP 401. */
class Unauthenticated : public std::runtime_error {
public:
    Unauthenticated() : std::runtime_error("Not authenticated") {}
};

/**
 * The record does not exist *or* the caller may not touch it. Both
 * cases share one message so a response never confirms that someone
 * else's record exists.
 */
class NotFound : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

/**
 * Arguments are read from the request's `variables`, keyed by argument
 * name. Clients must therefore pass every argument as a variable with
 * the same name as the argument: `person(id: $id)`, `login(input: $input)`.
 * Inline literals are not evaluated by this executor.
 */
class Args {
public:
    explicit Args(const oatpp::Any& variables) {
        if (variables) {
            m_obj = asObject(variables, "variables");
        }
    }

    /** Scalar argument as text, or nullopt if absent or JSON null. */
    std::optional<std::string> opt(const std::string& key) const {
        if (!m_obj) return std::nullopt;
        return scalarToString(lookup(key), key);
    }

    std::string req(const std::string& key) const {
        auto value = opt(key);
        if (!value) {
            throw std::invalid_argument("Missing argument: " + key);
        }
        return *value;
    }

    /** Input-object argument, e.g. `input`. */
    Args object(const std::string& key) const {
        auto value = m_obj ? lookup(key) : oatpp::Any();
        if (!value) {
            throw std::invalid_argument("Missing argument: " + key);
        }
        return Args(asObject(value, key));
    }

private:
    oatpp::Fields<oatpp::Any> m_obj;

    explicit Args(oatpp::Fields<oatpp::Any> obj) : m_obj(std::move(obj)) {}

    oatpp::Any lookup(const std::string& key) const {
        for (auto& pair : *m_obj) {
            if (pair.first == key) return pair.second;
        }
        return oatpp::Any();
    }

    static oatpp::Fields<oatpp::Any> asObject(const oatpp::Any& value, const std::string& name) {
        if (value.getStoredType() != oatpp::Fields<oatpp::Any>::Class::getType()) {
            throw std::invalid_argument("Expected an object for: " + name);
        }
        return value.retrieve<oatpp::Fields<oatpp::Any>>();
    }

    // The JSON mapper stores numbers as Int64 or Float64 and booleans as
    // Boolean, so retrieving everything as String would throw.
    //
    // Null checks compare with nullptr: oatpp::Boolean's operator! tests
    // the *value*, so `!b` would treat false as a missing argument.
    static std::optional<std::string> scalarToString(const oatpp::Any& value, const std::string& key) {
        if (!value) return std::nullopt;

        auto type = value.getStoredType();
        if (type == oatpp::String::Class::getType()) {
            auto s = value.retrieve<oatpp::String>();
            if (s == nullptr) return std::nullopt;
            return std::string(s->c_str());
        }
        if (type == oatpp::Int64::Class::getType()) {
            auto n = value.retrieve<oatpp::Int64>();
            if (n == nullptr) return std::nullopt;
            return std::to_string(*n);
        }
        if (type == oatpp::Float64::Class::getType()) {
            auto n = value.retrieve<oatpp::Float64>();
            if (n == nullptr) return std::nullopt;
            double d = *n;
            if (std::floor(d) == d) {
                return std::to_string(static_cast<long long>(d));
            }
            return std::to_string(d);
        }
        if (type == oatpp::Boolean::Class::getType()) {
            auto b = value.retrieve<oatpp::Boolean>();
            if (b == nullptr) return std::nullopt;
            return *b ? "true" : "false";
        }
        throw std::invalid_argument("Expected a scalar for: " + key);
    }
};

/** pqxx sends a null `const char*` as SQL NULL. */
inline const char* nullable(const std::optional<std::string>& value) {
    return value ? value->c_str() : nullptr;
}

inline oatpp::String textOrNull(const pqxx::field& field) {
    return field.is_null() ? oatpp::String(nullptr) : oatpp::String(field.c_str());
}

// ── Row mapping ─────────────────────────────────────────────
// Joined columns carry a prefix ("author_", "pb_", ...) so one row can
// hold several objects. Each *_SELECT below names its prefixes.

inline UserDto::Wrapper rowToUser(const pqxx::row& row, const std::string& prefix = "") {
    auto dto = UserDto::createShared();
    dto->id        = row[prefix + "id"].c_str();
    dto->name      = row[prefix + "name"].c_str();
    dto->username  = row[prefix + "username"].c_str();
    dto->createdAt = row[prefix + "created_at"].c_str();
    dto->updatedAt = row[prefix + "updated_at"].c_str();
    return dto;
}

inline PrayerBurdenDto::Wrapper rowToPrayerBurden(const pqxx::row& row, const std::string& prefix = "") {
    auto dto = PrayerBurdenDto::createShared();
    dto->id           = row[prefix + "id"].c_str();
    dto->content      = row[prefix + "content"].c_str();
    dto->releasedDate = textOrNull(row[prefix + "released_date"]);
    dto->createdAt    = row[prefix + "created_at"].c_str();
    dto->updatedAt    = row[prefix + "updated_at"].c_str();
    return dto;
}

inline const char* PERSON_SELECT =
    "SELECT p.id, p.name, p.age, p.year_met, p.last_contact_date, p.is_active, "
    "       p.created_at, p.updated_at, s.id AS status_id, s.name AS status_name "
    "FROM person p JOIN status s ON s.id = p.status_id ";

inline PersonDto::Wrapper rowToPerson(const pqxx::row& row) {
    auto dto = PersonDto::createShared();
    dto->id              = row["id"].c_str();
    dto->name            = row["name"].c_str();
    dto->lastContactDate = textOrNull(row["last_contact_date"]);
    dto->isActive        = row["is_active"].as<bool>();
    dto->createdAt       = row["created_at"].c_str();
    dto->updatedAt       = row["updated_at"].c_str();
    if (!row["age"].is_null())      dto->age     = row["age"].as<int>();
    if (!row["year_met"].is_null()) dto->yearMet = row["year_met"].as<int>();

    auto status = StatusDto::createShared();
    status->id   = row["status_id"].c_str();
    status->name = row["status_name"].c_str();
    dto->status = status;

    return dto;
}

inline const char* USER_SELECT =
    "SELECT u.id, u.name, u.username, u.created_at, u.updated_at FROM \"user\" u ";

inline const char* PRAYER_BURDEN_SELECT =
    "SELECT pb.id, pb.person_id, pb.content, pb.released_date, pb.created_at, pb.updated_at "
    "FROM prayer_burden pb ";

// Prefixes: "recorder_" for the user who logged it (may be null).
inline const char* MILESTONE_PERSON_SELECT =
    "SELECT mp.id, mp.date_achieved, mp.notes, mp.created_at, "
    "       m.id AS milestone_id, m.name AS milestone_name, m.description AS milestone_description, "
    "       u.id AS recorder_id, u.name AS recorder_name, u.username AS recorder_username, "
    "       u.created_at AS recorder_created_at, u.updated_at AS recorder_updated_at "
    "FROM milestone_person mp "
    "JOIN milestone m ON m.id = mp.milestone_id "
    "LEFT JOIN \"user\" u ON u.id = mp.recorded_by ";

inline MilestonePersonDto::Wrapper rowToMilestonePerson(const pqxx::row& row) {
    auto dto = MilestonePersonDto::createShared();
    dto->id           = row["id"].c_str();
    dto->dateAchieved = textOrNull(row["date_achieved"]);
    dto->notes        = textOrNull(row["notes"]);
    dto->createdAt    = row["created_at"].c_str();

    auto milestone = MilestoneDto::createShared();
    milestone->id          = row["milestone_id"].c_str();
    milestone->name        = row["milestone_name"].c_str();
    milestone->description = textOrNull(row["milestone_description"]);
    dto->milestone = milestone;

    if (!row["recorder_id"].is_null()) {
        dto->recordedBy = rowToUser(row, "recorder_");
    }
    return dto;
}

// Prefixes: "author_" for the writer, "pb_" for the linked burden (may be null).
inline const char* COMMENT_SELECT =
    "SELECT c.id, c.content, c.created_at, c.updated_at, "
    "       u.id AS author_id, u.name AS author_name, u.username AS author_username, "
    "       u.created_at AS author_created_at, u.updated_at AS author_updated_at, "
    "       pb.id AS pb_id, pb.content AS pb_content, pb.released_date AS pb_released_date, "
    "       pb.created_at AS pb_created_at, pb.updated_at AS pb_updated_at "
    "FROM comment c "
    "JOIN \"user\" u ON u.id = c.user_id "
    "LEFT JOIN prayer_burden pb ON pb.id = c.prayer_burden_id ";

inline CommentDto::Wrapper rowToComment(const pqxx::row& row) {
    auto dto = CommentDto::createShared();
    dto->id        = row["id"].c_str();
    dto->content   = row["content"].c_str();
    dto->createdAt = row["created_at"].c_str();
    dto->updatedAt = row["updated_at"].c_str();
    dto->author    = rowToUser(row, "author_");
    if (!row["pb_id"].is_null()) {
        dto->prayerBurden = rowToPrayerBurden(row, "pb_");
    }
    return dto;
}

// ── Lookups ─────────────────────────────────────────────────

/**
 * A person with every nested list loaded. Lists are empty, not null,
 * when there is nothing to show (business rules 2–4).
 */
inline PersonDto::Wrapper fetchPersonDetail(pqxx::work& txn, const std::string& personId) {
    auto rows = txn.exec_params(std::string(PERSON_SELECT) + "WHERE p.id = $1", personId);
    if (rows.empty()) {
        throw NotFound("Person not found");
    }
    auto person = rowToPerson(rows[0]);

    person->shepherds = oatpp::Vector<oatpp::Object<UserDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(USER_SELECT)
             + "JOIN user_person up ON up.user_id = u.id WHERE up.person_id = $1 ORDER BY u.name",
             personId)) {
        person->shepherds->push_back(rowToUser(row));
    }

    person->milestones = oatpp::Vector<oatpp::Object<MilestonePersonDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(MILESTONE_PERSON_SELECT)
             + "WHERE mp.person_id = $1 ORDER BY mp.date_achieved NULLS LAST, mp.created_at",
             personId)) {
        person->milestones->push_back(rowToMilestonePerson(row));
    }

    // Active burdens first, newest first within each group.
    person->prayerBurdens = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(PRAYER_BURDEN_SELECT)
             + "WHERE pb.person_id = $1 ORDER BY pb.released_date IS NOT NULL, pb.created_at DESC",
             personId)) {
        person->prayerBurdens->push_back(rowToPrayerBurden(row));
    }

    person->comments = oatpp::Vector<oatpp::Object<CommentDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(COMMENT_SELECT) + "WHERE c.person_id = $1 ORDER BY c.created_at DESC",
             personId)) {
        person->comments->push_back(rowToComment(row));
    }

    return person;
}

// ── Authorization ───────────────────────────────────────────

/** True if `userId` is one of the person's shepherds. */
inline bool isShepherd(pqxx::work& txn, const std::string& userId, const std::string& personId) {
    auto rows = txn.exec_params(
        "SELECT 1 FROM user_person WHERE user_id = $1 AND person_id = $2",
        userId, personId);
    return !rows.empty();
}

/**
 * Every read or write on a person's data goes through this: only the
 * people assigned to you are visible to you. Run it inside the same
 * transaction as the write it guards.
 */
inline void requireShepherd(pqxx::work& txn, const std::string& userId, const std::string& personId) {
    if (!isShepherd(txn, userId, personId)) {
        throw NotFound("Person not found");
    }
}

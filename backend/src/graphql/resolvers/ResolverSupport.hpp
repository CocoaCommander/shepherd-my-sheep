#pragma once

#include "../../models/DTOs.hpp"
#include "../ErrorMapping.hpp"

#include <pqxx/pqxx>

#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>

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
 * The record already exists, e.g. a taken username or a repeated milestone,
 * or it has changed since the client last saw it.
 */
class Conflict : public std::runtime_error {
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
            throw BadInput("Missing argument: " + key);
        }
        return *value;
    }

    /** Input-object argument, e.g. `input`. */
    Args object(const std::string& key) const {
        auto value = m_obj ? lookup(key) : oatpp::Any();
        if (!value) {
            throw BadInput("Missing argument: " + key);
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
            throw BadInput("Expected an object for: " + name);
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
        throw BadInput("Expected a scalar for: " + key);
    }
};

/** pqxx sends a null `const char*` as SQL NULL. */
inline const char* nullable(const std::optional<std::string>& value) {
    return value ? value->c_str() : nullptr;
}

/** `value` without leading or trailing whitespace. */
inline std::string trim(const std::string& value) {
    const char* space = " \t\n\r\f\v";
    auto        first = value.find_first_not_of(space);
    if (first == std::string::npos) return "";
    return value.substr(first, value.find_last_not_of(space) - first + 1);
}

inline bool isBlank(const std::string& value) {
    return trim(value).empty();
}

inline oatpp::String textOrNull(const pqxx::field& field) {
    return field.is_null() ? oatpp::String(nullptr) : oatpp::String(field.c_str());
}

// ── Row mapping ─────────────────────────────────────────────
// Joined columns carry a prefix ("author_", "pb_", ...) so one row can
// hold several objects. Each *_SELECT below names its prefixes.

inline UserDto::Wrapper rowToUser(const pqxx::row& row, const std::string& prefix = "") {
    auto dto       = UserDto::createShared();
    dto->id        = row[prefix + "id"].c_str();
    dto->name      = row[prefix + "name"].c_str();
    dto->username  = row[prefix + "username"].c_str();
    dto->createdAt = row[prefix + "created_at"].c_str();
    dto->updatedAt = row[prefix + "updated_at"].c_str();
    return dto;
}

inline PrayerBurdenDto::Wrapper rowToPrayerBurden(const pqxx::row& row, const std::string& prefix = "") {
    auto dto          = PrayerBurdenDto::createShared();
    dto->id           = row[prefix + "id"].c_str();
    dto->content      = row[prefix + "content"].c_str();
    dto->releasedDate = textOrNull(row[prefix + "released_date"]);
    dto->createdAt    = row[prefix + "created_at"].c_str();
    dto->updatedAt    = row[prefix + "updated_at"].c_str();
    return dto;
}

// Contact columns come from the person_contact_state view (business rule 6).
// The recorded milestones, the active burden count and the latest comment
// ("lc_" prefix, null when there are no comments) and the last prayer
// ("lp_" prefix, null when no one has prayed yet) are summaries, so list
// queries can show them without loading the nested lists.
inline const char* PERSON_SELECT =
    "SELECT p.id, p.name, p.age, p.year_met, p.is_active, "
    "       p.created_at, p.updated_at, p.status_changed_at, s.id AS status_id, s.name AS status_name, "
    "       cs.last_contacted_at, "
    "       cs.contact_due_at, cs.contact_clock_start, cs.contact_state, "
    "       (SELECT string_agg(mp.milestone_id::text, ',' ORDER BY mp.milestone_id) "
    "          FROM milestone_person mp WHERE mp.person_id = p.id) AS milestone_ids, "
    "       (SELECT count(*) FROM prayer_burden pb "
    "         WHERE pb.person_id = p.id AND pb.released_date IS NULL) AS active_burden_count, "
    "       lc.*, lp.* "
    "FROM person p JOIN status s ON s.id = p.status_id "
    "JOIN person_contact_state cs ON cs.person_id = p.id "
    "LEFT JOIN LATERAL ("
    "    SELECT c.id AS lc_id, c.content AS lc_content, c.created_at AS lc_created_at, c.updated_at AS lc_updated_at, "
    "           c.contact_log_id AS lc_contact_log_id, "
    "           u.id AS lc_author_id, u.name AS lc_author_name, u.username AS lc_author_username, "
    "           u.created_at AS lc_author_created_at, u.updated_at AS lc_author_updated_at, "
    "           pb.id AS lc_pb_id, pb.content AS lc_pb_content, pb.released_date AS lc_pb_released_date, "
    "           pb.created_at AS lc_pb_created_at, pb.updated_at AS lc_pb_updated_at "
    "    FROM comment c "
    "    JOIN \"user\" u ON u.id = c.user_id "
    "    LEFT JOIN prayer_burden pb ON pb.id = c.prayer_burden_id "
    "    WHERE c.person_id = p.id "
    "    ORDER BY c.created_at DESC, c.id DESC LIMIT 1"
    ") lc ON true "
    "LEFT JOIN LATERAL ("
    "    SELECT pl.id AS lp_id, pl.prayed_at AS lp_prayed_at, pl.created_at AS lp_created_at, "
    "           u.id AS lp_prayer_id, u.name AS lp_prayer_name, u.username AS lp_prayer_username, "
    "           u.created_at AS lp_prayer_created_at, u.updated_at AS lp_prayer_updated_at "
    "    FROM prayer_log pl "
    "    LEFT JOIN \"user\" u ON u.id = pl.user_id "
    "    WHERE pl.person_id = p.id "
    "    ORDER BY pl.prayed_at DESC, pl.created_at DESC, pl.id DESC LIMIT 1"
    ") lp ON true ";

inline CommentDto::Wrapper   rowToComment(const pqxx::row& row, const std::string& prefix = "");
inline PrayerLogDto::Wrapper rowToPrayerLog(const pqxx::row& row, const std::string& prefix = "");

inline PersonDto::Wrapper rowToPerson(const pqxx::row& row) {
    auto dto               = PersonDto::createShared();
    dto->id                = row["id"].c_str();
    dto->name              = row["name"].c_str();
    dto->lastContactedAt   = textOrNull(row["last_contacted_at"]);
    dto->contactDueAt      = textOrNull(row["contact_due_at"]);
    dto->contactClockStart = textOrNull(row["contact_clock_start"]);
    dto->contactState      = row["contact_state"].c_str();
    dto->statusChangedAt   = textOrNull(row["status_changed_at"]);
    dto->isActive          = row["is_active"].as<bool>();
    dto->createdAt         = row["created_at"].c_str();
    dto->updatedAt         = row["updated_at"].c_str();
    if (!row["age"].is_null()) dto->age = row["age"].as<int>();
    if (!row["year_met"].is_null()) dto->yearMet = row["year_met"].as<int>();
    dto->activeBurdenCount = row["active_burden_count"].as<int>();

    // Comma-separated UUIDs, or null for none (business rule 2).
    dto->recordedMilestoneIds = oatpp::Vector<oatpp::String>::createShared();
    if (!row["milestone_ids"].is_null()) {
        std::string ids = row["milestone_ids"].c_str();
        for (size_t start = 0, end; start < ids.size(); start = end + 1) {
            end = ids.find(',', start);
            if (end == std::string::npos) end = ids.size();
            dto->recordedMilestoneIds->push_back(ids.substr(start, end - start));
        }
    }
    if (!row["lc_id"].is_null()) dto->latestComment = rowToComment(row, "lc_");
    if (!row["lp_id"].is_null()) dto->lastPrayer = rowToPrayerLog(row, "lp_");

    auto status  = StatusDto::createShared();
    status->id   = row["status_id"].c_str();
    status->name = row["status_name"].c_str();
    dto->status  = status;

    return dto;
}

inline const char* USER_SELECT = "SELECT u.id, u.name, u.username, u.created_at, u.updated_at FROM \"user\" u ";

inline const char* PRAYER_BURDEN_SELECT =
    "SELECT pb.id, pb.person_id, pb.content, pb.released_date, pb.created_at, pb.updated_at "
    "FROM prayer_burden pb ";

// A burden a root field returns, with its person's name and status so a list
// across people can say whose each one is and show their status.
inline const char* BURDEN_SELECT =
    "SELECT pb.id, pb.person_id, pb.content, pb.released_date, pb.created_at, pb.updated_at, "
    "       p.name AS person_name, s.id AS person_status_id, s.name AS person_status_name "
    "FROM prayer_burden pb "
    "JOIN person p ON p.id = pb.person_id "
    "JOIN status s ON s.id = p.status_id ";

/** A BURDEN_SELECT row, with `person` set (id, name and status only). */
inline PrayerBurdenDto::Wrapper rowToBurdenWithPerson(const pqxx::row& row) {
    auto burden = rowToPrayerBurden(row);

    auto person  = PersonRefDto::createShared();
    person->id   = row["person_id"].c_str();
    person->name = row["person_name"].c_str();

    auto status    = StatusDto::createShared();
    status->id     = row["person_status_id"].c_str();
    status->name   = row["person_status_name"].c_str();
    person->status = status;

    burden->person = person;
    return burden;
}

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
    auto dto          = MilestonePersonDto::createShared();
    dto->id           = row["id"].c_str();
    dto->dateAchieved = textOrNull(row["date_achieved"]);
    dto->notes        = textOrNull(row["notes"]);
    dto->createdAt    = row["created_at"].c_str();

    auto milestone         = MilestoneDto::createShared();
    milestone->id          = row["milestone_id"].c_str();
    milestone->name        = row["milestone_name"].c_str();
    milestone->description = textOrNull(row["milestone_description"]);
    dto->milestone         = milestone;

    if (!row["recorder_id"].is_null()) {
        dto->recordedBy = rowToUser(row, "recorder_");
    }
    return dto;
}

// Prefixes: "author_" for the writer, "pb_" for the linked burden (may be null).
inline const char* COMMENT_SELECT =
    "SELECT c.id, c.content, c.created_at, c.updated_at, c.contact_log_id, "
    "       u.id AS author_id, u.name AS author_name, u.username AS author_username, "
    "       u.created_at AS author_created_at, u.updated_at AS author_updated_at, "
    "       pb.id AS pb_id, pb.content AS pb_content, pb.released_date AS pb_released_date, "
    "       pb.created_at AS pb_created_at, pb.updated_at AS pb_updated_at "
    "FROM comment c "
    "JOIN \"user\" u ON u.id = c.user_id "
    "LEFT JOIN prayer_burden pb ON pb.id = c.prayer_burden_id ";

inline CommentDto::Wrapper rowToComment(const pqxx::row& row, const std::string& prefix) {
    auto dto          = CommentDto::createShared();
    dto->id           = row[prefix + "id"].c_str();
    dto->content      = row[prefix + "content"].c_str();
    dto->createdAt    = row[prefix + "created_at"].c_str();
    dto->updatedAt    = row[prefix + "updated_at"].c_str();
    dto->contactLogId = textOrNull(row[prefix + "contact_log_id"]);
    dto->author       = rowToUser(row, prefix + "author_");
    if (!row[prefix + "pb_id"].is_null()) {
        dto->prayerBurden = rowToPrayerBurden(row, prefix + "pb_");
    }
    return dto;
}

/**
 * Fills `comments` on a list of burdens with one query, newest first. Empty,
 * not null, for a burden with none (business rule 4). The comments' own
 * `prayerBurden` stays shallow, so there is no burden → comments → burden cycle.
 */
inline void loadBurdenComments(pqxx::work& txn, const oatpp::Vector<oatpp::Object<PrayerBurdenDto>>& burdens) {
    if (burdens->empty()) return;

    // libpqxx 6 can't bind a container, so the ids go as one array literal.
    std::unordered_map<std::string, oatpp::Vector<oatpp::Object<CommentDto>>> byBurden;
    std::string                                                               ids = "{";
    for (const auto& burden : *burdens) {
        burden->comments = oatpp::Vector<oatpp::Object<CommentDto>>::createShared();
        byBurden.emplace(*burden->id, burden->comments);
        if (ids.size() > 1) ids += ",";
        ids += *burden->id;
    }
    ids += "}";

    for (const auto& row : txn.exec_params(std::string(COMMENT_SELECT)
                                               + "WHERE c.prayer_burden_id = ANY($1::uuid[]) "
                                                 "ORDER BY c.created_at DESC, c.id DESC",
                                           ids)) {
        byBurden.at(row["pb_id"].c_str())->push_back(rowToComment(row));
    }
}

/**
 * Fills `shepherds` on a list of people with one query, so list screens
 * can say who else cares for each person. Empty, not null, for nobody.
 */
inline void loadShepherds(pqxx::work& txn, const oatpp::Vector<oatpp::Object<PersonDto>>& people) {
    if (people->empty()) return;

    // libpqxx 6 can't bind a container, so the ids go as one array literal.
    std::unordered_map<std::string, oatpp::Vector<oatpp::Object<UserDto>>> byPerson;
    std::string                                                            ids = "{";
    for (const auto& person : *people) {
        person->shepherds = oatpp::Vector<oatpp::Object<UserDto>>::createShared();
        byPerson.emplace(*person->id, person->shepherds);
        if (ids.size() > 1) ids += ",";
        ids += *person->id;
    }
    ids += "}";

    for (const auto& row : txn.exec_params("SELECT u.id, u.name, u.username, u.created_at, u.updated_at, up.person_id "
                                           "FROM user_person up JOIN \"user\" u ON u.id = up.user_id "
                                           "WHERE up.person_id = ANY($1::uuid[]) ORDER BY u.name",
                                           ids)) {
        byPerson.at(row["person_id"].c_str())->push_back(rowToUser(row));
    }
}

// Prefix: "contactor_" for the user who made contact (may be null).
// The note is the standalone comment written with the contact, if any.
inline const char* CONTACT_LOG_SELECT =
    "SELECT cl.id, cl.person_id, cl.contacted_at, cl.is_follow_up, n.content AS note, cl.created_at, "
    "       u.id AS contactor_id, u.name AS contactor_name, u.username AS contactor_username, "
    "       u.created_at AS contactor_created_at, u.updated_at AS contactor_updated_at "
    "FROM contact_log cl "
    "LEFT JOIN \"user\" u ON u.id = cl.user_id "
    "LEFT JOIN comment n ON n.contact_log_id = cl.id ";

inline ContactLogDto::Wrapper rowToContactLog(const pqxx::row& row) {
    auto dto         = ContactLogDto::createShared();
    dto->id          = row["id"].c_str();
    dto->contactedAt = row["contacted_at"].c_str();
    dto->isFollowUp  = row["is_follow_up"].as<bool>();
    dto->note        = textOrNull(row["note"]);
    dto->createdAt   = row["created_at"].c_str();
    if (!row["contactor_id"].is_null()) {
        dto->contactedBy = rowToUser(row, "contactor_");
    }
    return dto;
}

// Prefix: "prayer_" for the user who prayed (null if they were deleted).
inline const char* PRAYER_LOG_SELECT =
    "SELECT pl.id, pl.person_id, pl.prayed_at, pl.created_at, "
    "       u.id AS prayer_id, u.name AS prayer_name, u.username AS prayer_username, "
    "       u.created_at AS prayer_created_at, u.updated_at AS prayer_updated_at "
    "FROM prayer_log pl "
    "LEFT JOIN \"user\" u ON u.id = pl.user_id ";

// Newest first by when they prayed; a back-dated record sorts by its day.
inline const char* PRAYER_LOG_ORDER = "ORDER BY pl.prayed_at DESC, pl.created_at DESC, pl.id DESC";

inline PrayerLogDto::Wrapper rowToPrayerLog(const pqxx::row& row, const std::string& prefix) {
    auto dto       = PrayerLogDto::createShared();
    dto->id        = row[prefix + "id"].c_str();
    dto->prayedAt  = row[prefix + "prayed_at"].c_str();
    dto->createdAt = row[prefix + "created_at"].c_str();
    if (!row[prefix + "prayer_id"].is_null()) {
        dto->prayedBy = rowToUser(row, prefix + "prayer_");
    }
    return dto;
}

// ── Lookups ─────────────────────────────────────────────────

/**
 * A person with every nested list loaded. Lists are empty, not null,
 * when there is nothing to show (business rules 2–4, and no contacts yet).
 */
inline PersonDto::Wrapper fetchPersonDetail(pqxx::work& txn, const std::string& personId) {
    auto rows = txn.exec_params(std::string(PERSON_SELECT) + "WHERE p.id = $1", personId);
    if (rows.empty()) {
        throw NotFound("Person not found");
    }
    auto person = rowToPerson(rows[0]);

    person->shepherds = oatpp::Vector<oatpp::Object<UserDto>>::createShared();
    for (const auto& row :
         txn.exec_params(std::string(USER_SELECT)
                             + "JOIN user_person up ON up.user_id = u.id WHERE up.person_id = $1 ORDER BY u.name",
                         personId)) {
        person->shepherds->push_back(rowToUser(row));
    }

    person->milestones = oatpp::Vector<oatpp::Object<MilestonePersonDto>>::createShared();
    for (const auto& row :
         txn.exec_params(std::string(MILESTONE_PERSON_SELECT)
                             + "WHERE mp.person_id = $1 ORDER BY mp.date_achieved NULLS LAST, mp.created_at",
                         personId)) {
        person->milestones->push_back(rowToMilestonePerson(row));
    }

    // Active burdens first, newest first within each group.
    person->prayerBurdens = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
    for (const auto& row :
         txn.exec_params(std::string(PRAYER_BURDEN_SELECT)
                             + "WHERE pb.person_id = $1 ORDER BY pb.released_date IS NOT NULL, pb.created_at DESC",
                         personId)) {
        person->prayerBurdens->push_back(rowToPrayerBurden(row));
    }

    person->comments = oatpp::Vector<oatpp::Object<CommentDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(COMMENT_SELECT) + "WHERE c.person_id = $1 ORDER BY c.created_at DESC, c.id DESC", personId)) {
        person->comments->push_back(rowToComment(row));
    }

    // Each burden gets its own comments from the list just loaded, newest
    // first, with no extra query. Its person is the parent, so left unset.
    std::unordered_map<std::string, oatpp::Vector<oatpp::Object<CommentDto>>> byBurden;
    for (const auto& burden : *person->prayerBurdens) {
        burden->comments = oatpp::Vector<oatpp::Object<CommentDto>>::createShared();
        byBurden.emplace(*burden->id, burden->comments);
    }
    for (const auto& comment : *person->comments) {
        if (comment->prayerBurden) byBurden.at(*comment->prayerBurden->id)->push_back(comment);
    }

    person->contacts = oatpp::Vector<oatpp::Object<ContactLogDto>>::createShared();
    for (const auto& row : txn.exec_params(
             std::string(CONTACT_LOG_SELECT) + "WHERE cl.person_id = $1 ORDER BY cl.contacted_at DESC", personId)) {
        person->contacts->push_back(rowToContactLog(row));
    }

    // Every record: the client shows the newest few and expands the rest.
    person->prayers = oatpp::Vector<oatpp::Object<PrayerLogDto>>::createShared();
    for (const auto& row :
         txn.exec_params(std::string(PRAYER_LOG_SELECT) + "WHERE pl.person_id = $1 " + PRAYER_LOG_ORDER, personId)) {
        person->prayers->push_back(rowToPrayerLog(row));
    }

    return person;
}

/**
 * One burden as a root field returns it: with its person (id, name and
 * status) and its comments. Run it after the write that changed the burden.
 */
inline PrayerBurdenDto::Wrapper fetchBurden(pqxx::work& txn, const std::string& burdenId) {
    auto rows = txn.exec_params(std::string(BURDEN_SELECT) + "WHERE pb.id = $1", burdenId);
    if (rows.empty()) {
        throw NotFound("Prayer burden not found");
    }
    auto list = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
    list->push_back(rowToBurdenWithPerson(rows[0]));
    loadBurdenComments(txn, list);
    return list->front();
}

// ── Authorization ───────────────────────────────────────────

/** True if `userId` is one of the person's shepherds. */
inline bool isShepherd(pqxx::work& txn, const std::string& userId, const std::string& personId) {
    auto rows = txn.exec_params("SELECT 1 FROM user_person WHERE user_id = $1 AND person_id = $2", userId, personId);
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

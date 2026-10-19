#pragma once

#include "../../db/DatabasePool.hpp"
#include "../../models/DTOs.hpp"
#include "ResolverSupport.hpp"

#include <pqxx/pqxx>
#include <memory>
#include <string>

/**
 * Handles GraphQL query operations (reads).
 *
 * Reads use plain SQL queries (not stored procedures) so we can
 * be flexible about which fields to return.
 *
 * Every query needs a signed-in user; GraphQLController rejects the
 * request before it gets here otherwise. Person data is scoped to the
 * people assigned to that user.
 */
class QueryResolver {
public:
    explicit QueryResolver(std::shared_ptr<DatabasePool> dbPool) : m_dbPool(std::move(dbPool)) {}

    oatpp::Any resolve(const std::string& field, const Args& args, const std::string& userId) {
        if (field == "me") return resolveMe(userId);
        if (field == "myPeople") return resolveMyPeople(userId);
        if (field == "contactAlerts") return resolveContactAlerts(userId);
        if (field == "person") return resolvePerson(args, userId);
        if (field == "statuses") return resolveStatuses();
        if (field == "milestones") return resolveMilestones();
        if (field == "activePrayerBurdens") return resolveActivePrayerBurdens(args, userId);
        if (field == "searchUsers") return resolveSearchUsers(args, userId);

        throw BadInput("Unknown query: " + field);
    }

private:
    std::shared_ptr<DatabasePool> m_dbPool;

    oatpp::Any resolveMe(const std::string& userId) {
        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec_params(std::string(USER_SELECT) + "WHERE u.id = $1", userId);
        txn.commit();

        // A valid token for a deleted account: treat as signed out.
        if (result.empty()) {
            throw Unauthenticated();
        }
        return rowToUser(result[0]);
    }

    oatpp::Any resolveStatuses() {
        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec("SELECT id, name FROM status ORDER BY name");
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<StatusDto>>::createShared();
        for (const auto& row : result) {
            auto dto  = StatusDto::createShared();
            dto->id   = row["id"].c_str();
            dto->name = row["name"].c_str();
            list->push_back(dto);
        }
        return list;
    }

    oatpp::Any resolveMilestones() {
        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec("SELECT id, name, description FROM milestone ORDER BY name");
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<MilestoneDto>>::createShared();
        for (const auto& row : result) {
            auto dto         = MilestoneDto::createShared();
            dto->id          = row["id"].c_str();
            dto->name        = row["name"].c_str();
            dto->description = textOrNull(row["description"]);
            list->push_back(dto);
        }
        return list;
    }

    /** Null, not an error, when the person is missing or not yours. */
    oatpp::Any resolvePerson(const Args& args, const std::string& userId) {
        auto personId = args.req("id");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        if (!isShepherd(txn, userId, personId)) {
            return oatpp::Any();
        }
        auto person = fetchPersonDetail(txn, personId);
        txn.commit();
        return person;
    }

    /** May be empty — a new user has no one assigned (business rule 1). */
    oatpp::Any resolveMyPeople(const std::string& userId) {
        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec_params(std::string(PERSON_SELECT)
                                          + "JOIN user_person up ON up.person_id = p.id "
                                            "WHERE up.user_id = $1 "
                                            "ORDER BY p.name",
                                      userId);

        auto list = oatpp::Vector<oatpp::Object<PersonDto>>::createShared();
        for (const auto& row : result) {
            list->push_back(rowToPerson(row));
        }
        loadShepherds(txn, list);
        txn.commit();
        return list;
    }

    /**
     * Your people who are overdue or due soon (business rule 6), most
     * urgent first. Every shepherd of a shared person sees the alert. May
     * be empty.
     */
    oatpp::Any resolveContactAlerts(const std::string& userId) {
        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec_params(std::string(PERSON_SELECT)
                                          + "JOIN user_person up ON up.person_id = p.id "
                                            "WHERE up.user_id = $1 AND cs.contact_state IN ('OVERDUE', 'DUE_SOON') "
                                            "ORDER BY cs.contact_due_at, p.name",
                                      userId);

        auto list = oatpp::Vector<oatpp::Object<PersonDto>>::createShared();
        for (const auto& row : result) {
            list->push_back(rowToPerson(row));
        }
        loadShepherds(txn, list);
        txn.commit();
        return list;
    }

    static constexpr size_t MIN_SEARCH_LENGTH  = 2;
    static constexpr size_t MAX_SEARCH_LENGTH  = 100;
    static constexpr int    MAX_SEARCH_RESULTS = 10;

    /** UTF-8 characters, not bytes, so names in any script count the same. */
    static size_t characterCount(const std::string& text) {
        size_t count = 0;
        for (unsigned char c : text) {
            if ((c & 0xC0) != 0x80) ++count;
        }
        return count;
    }

    /** Makes LIKE's wildcards (and its escape character) match literally. */
    static std::string escapeLike(const std::string& text) {
        std::string out;
        for (char c : text) {
            if (c == '\\' || c == '%' || c == '_') out.push_back('\\');
            out.push_back(c);
        }
        return out;
    }

    /**
     * Finds other users by part of their name or username, for adding a
     * shepherd. Any signed-in user may search everyone; results are capped
     * and very short queries return nothing, so it can't list all users at
     * once.
     */
    oatpp::Any resolveSearchUsers(const Args& args, const std::string& userId) {
        auto       raw   = args.req("query");
        const auto first = raw.find_first_not_of(" \t\n\r");
        const auto query =
            first == std::string::npos ? "" : raw.substr(first, raw.find_last_not_of(" \t\n\r") - first + 1);

        auto list = oatpp::Vector<oatpp::Object<UserDto>>::createShared();
        if (characterCount(query) > MAX_SEARCH_LENGTH) {
            throw BadInput("Search is too long");
        }
        if (characterCount(query) < MIN_SEARCH_LENGTH) {
            return list;
        }

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto pattern = "%" + escapeLike(query) + "%";
        auto result  = txn.exec_params(std::string(USER_SELECT)
                                           + "WHERE u.id <> $1 "
                                              "  AND (u.name ILIKE $2 ESCAPE '\\' OR u.username ILIKE $2 ESCAPE '\\') "
                                              "ORDER BY u.name, u.username "
                                              "LIMIT $3",
                                       userId, pattern, MAX_SEARCH_RESULTS);
        txn.commit();

        for (const auto& row : result) {
            list->push_back(rowToUser(row));
        }
        return list;
    }

    /** Across all of your people, or one of them when personId is given. */
    oatpp::Any resolveActivePrayerBurdens(const Args& args, const std::string& userId) {
        auto personId = args.opt("personId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        // Adds the person's name, so a list across people can say whose each one is.
        auto result = txn.exec_params("SELECT pb.id, pb.person_id, pb.content, pb.released_date, pb.created_at, "
                                      "       pb.updated_at, p.name AS person_name "
                                      "FROM prayer_burden pb "
                                      "JOIN person p ON p.id = pb.person_id "
                                      "JOIN user_person up ON up.person_id = pb.person_id AND up.user_id = $1 "
                                      "WHERE pb.released_date IS NULL "
                                      "  AND ($2::uuid IS NULL OR pb.person_id = $2::uuid) "
                                      "ORDER BY pb.created_at DESC",
                                      userId, nullable(personId));
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
        for (const auto& row : result) {
            auto burden    = rowToPrayerBurden(row);
            auto person    = PersonRefDto::createShared();
            person->id     = row["person_id"].c_str();
            person->name   = row["person_name"].c_str();
            burden->person = person;
            list->push_back(burden);
        }
        return list;
    }
};

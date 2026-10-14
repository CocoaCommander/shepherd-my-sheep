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
        if (field == "person") return resolvePerson(args, userId);
        if (field == "statuses") return resolveStatuses();
        if (field == "milestones") return resolveMilestones();
        if (field == "activePrayerBurdens") return resolveActivePrayerBurdens(args, userId);

        throw std::invalid_argument("Unknown query: " + field);
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
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<PersonDto>>::createShared();
        for (const auto& row : result) {
            list->push_back(rowToPerson(row));
        }
        return list;
    }

    /** Across all of your people, or one of them when personId is given. */
    oatpp::Any resolveActivePrayerBurdens(const Args& args, const std::string& userId) {
        auto personId = args.opt("personId");

        PooledConnection conn(m_dbPool);
        pqxx::work       txn(*conn);

        auto result = txn.exec_params(std::string(PRAYER_BURDEN_SELECT)
                                          + "JOIN user_person up ON up.person_id = pb.person_id AND up.user_id = $1 "
                                            "WHERE pb.released_date IS NULL "
                                            "  AND ($2::uuid IS NULL OR pb.person_id = $2::uuid) "
                                            "ORDER BY pb.created_at DESC",
                                      userId, nullable(personId));
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
        for (const auto& row : result) {
            list->push_back(rowToPrayerBurden(row));
        }
        return list;
    }
};

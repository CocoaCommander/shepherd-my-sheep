#pragma once

#include "../../db/DatabasePool.hpp"
#include "../../models/DTOs.hpp"

#include <pqxx/pqxx>
#include <memory>
#include <string>

/**
 * Handles GraphQL query operations (reads).
 *
 * Reads use plain SQL queries (not stored procedures) so we can
 * be flexible about which fields to return.
 */
class QueryResolver {
public:
    explicit QueryResolver(std::shared_ptr<DatabasePool> dbPool)
        : m_dbPool(dbPool) {}

    oatpp::Any resolve(const std::string& query, const oatpp::Any& variables) {
        if (query.find("myPeople") != std::string::npos) {
            return resolveMyPeople(variables);
        }
        if (query.find("person") != std::string::npos) {
            return resolvePerson(variables);
        }
        if (query.find("statuses") != std::string::npos) {
            return resolveStatuses();
        }
        if (query.find("milestones") != std::string::npos) {
            return resolveMilestones();
        }
        if (query.find("activePrayerBurdens") != std::string::npos) {
            return resolveActivePrayerBurdens(variables);
        }

        throw std::runtime_error("Unknown query");
    }

private:
    std::shared_ptr<DatabasePool> m_dbPool;

    // ── Helpers ─────────────────────────────────────────────

    static std::string extractVar(const oatpp::Any& variables, const std::string& key) {
        if (!variables) throw std::runtime_error("Missing variables");
        auto fields = variables.retrieve<oatpp::Fields<oatpp::Any>>();
        for (auto& pair : *fields) {
            if (pair.first == key) {
                return pair.second.retrieve<oatpp::String>()->c_str();
            }
        }
        throw std::runtime_error("Missing variable: " + key);
    }

    static std::string extractVarOrEmpty(const oatpp::Any& variables, const std::string& key) {
        if (!variables) return "";
        auto fields = variables.retrieve<oatpp::Fields<oatpp::Any>>();
        for (auto& pair : *fields) {
            if (pair.first == key && pair.second) {
                return pair.second.retrieve<oatpp::String>()->c_str();
            }
        }
        return "";
    }

    static PersonDto::Wrapper rowToPerson(const pqxx::row& row) {
        auto dto = PersonDto::createShared();
        dto->id        = row["id"].c_str();
        dto->name      = row["name"].c_str();
        dto->isActive  = row["is_active"].as<bool>();
        dto->createdAt = row["created_at"].c_str();
        dto->updatedAt = row["updated_at"].c_str();

        if (!row["age"].is_null())               dto->age = row["age"].as<int>();
        if (!row["year_met"].is_null())           dto->yearMet = row["year_met"].as<int>();
        if (!row["last_contact_date"].is_null())  dto->lastContactDate = row["last_contact_date"].c_str();

        auto status = StatusDto::createShared();
        status->id   = row["status_id"].c_str();
        status->name = row["status_name"].c_str();
        dto->status = status;

        return dto;
    }

    // ── Resolvers ───────────────────────────────────────────

    oatpp::Any resolveStatuses() {
        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec("SELECT id, name FROM status ORDER BY name");
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<StatusDto>>::createShared();
        for (const auto& row : result) {
            auto dto = StatusDto::createShared();
            dto->id   = row["id"].c_str();
            dto->name = row["name"].c_str();
            list->push_back(dto);
        }
        return list;
    }

    oatpp::Any resolveMilestones() {
        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec("SELECT id, name, description FROM milestone ORDER BY name");
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<MilestoneDto>>::createShared();
        for (const auto& row : result) {
            auto dto = MilestoneDto::createShared();
            dto->id   = row["id"].c_str();
            dto->name = row["name"].c_str();
            if (!row["description"].is_null()) {
                dto->description = row["description"].c_str();
            }
            list->push_back(dto);
        }
        return list;
    }

    oatpp::Any resolvePerson(const oatpp::Any& variables) {
        auto personId = extractVar(variables, "id");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT p.*, s.name AS status_name "
            "FROM person p "
            "JOIN status s ON s.id = p.status_id "
            "WHERE p.id = $1",
            personId
        );
        txn.commit();

        if (result.empty()) {
            return oatpp::Any();  // null — person not found
        }

        return rowToPerson(result[0]);
    }

    oatpp::Any resolveMyPeople(const oatpp::Any& variables) {
        auto userId = extractVar(variables, "userId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT p.*, s.name AS status_name "
            "FROM person p "
            "JOIN status s ON s.id = p.status_id "
            "JOIN user_person up ON up.person_id = p.id "
            "WHERE up.user_id = $1 "
            "ORDER BY p.name",
            userId
        );
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<PersonDto>>::createShared();
        for (const auto& row : result) {
            list->push_back(rowToPerson(row));
        }
        return list;
    }

    oatpp::Any resolveActivePrayerBurdens(const oatpp::Any& variables) {
        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto personId = extractVarOrEmpty(variables, "personId");

        pqxx::result result;
        if (personId.empty()) {
            result = txn.exec(
                "SELECT id, person_id, content, released_date, created_at, updated_at "
                "FROM prayer_burden WHERE released_date IS NULL "
                "ORDER BY created_at DESC"
            );
        } else {
            result = txn.exec_params(
                "SELECT id, person_id, content, released_date, created_at, updated_at "
                "FROM prayer_burden WHERE released_date IS NULL AND person_id = $1 "
                "ORDER BY created_at DESC",
                personId
            );
        }
        txn.commit();

        auto list = oatpp::Vector<oatpp::Object<PrayerBurdenDto>>::createShared();
        for (const auto& row : result) {
            auto dto = PrayerBurdenDto::createShared();
            dto->id        = row["id"].c_str();
            dto->content   = row["content"].c_str();
            dto->createdAt = row["created_at"].c_str();
            dto->updatedAt = row["updated_at"].c_str();
            list->push_back(dto);
        }
        return list;
    }
};

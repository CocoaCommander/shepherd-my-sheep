#pragma once

#include "../../db/DatabasePool.hpp"
#include "../../models/DTOs.hpp"
#include "../../auth/PasswordHasher.hpp"
#include "../../auth/JWTService.hpp"

#include <pqxx/pqxx>
#include <memory>
#include <string>

/**
 * Handles GraphQL mutation operations (writes).
 *
 * All writes go through PostgreSQL stored procedures so the app
 * and tests exercise the exact same code path. Password hashing is the
 * one thing deliberately kept out of the database — see PasswordHasher.
 */
class MutationResolver {
public:
    MutationResolver(std::shared_ptr<DatabasePool> dbPool,
                     std::shared_ptr<JWTService> jwtService)
        : m_dbPool(dbPool), m_jwt(jwtService) {}

    oatpp::Any resolve(const std::string& query, const oatpp::Any& variables) {
        if (query.find("register") != std::string::npos) {
            return resolveRegister(variables);
        }
        if (query.find("login") != std::string::npos) {
            return resolveLogin(variables);
        }
        if (query.find("createPerson") != std::string::npos) {
            return resolveCreatePerson(variables);
        }
        if (query.find("updatePerson") != std::string::npos) {
            return resolveUpdatePerson(variables);
        }
        if (query.find("deletePerson") != std::string::npos) {
            return resolveDeletePerson(variables);
        }
        if (query.find("assignPerson") != std::string::npos) {
            return resolveAssignPerson(variables);
        }
        if (query.find("unassignPerson") != std::string::npos) {
            return resolveUnassignPerson(variables);
        }
        if (query.find("recordMilestone") != std::string::npos) {
            return resolveRecordMilestone(variables);
        }
        if (query.find("removeMilestone") != std::string::npos) {
            return resolveRemoveMilestone(variables);
        }
        if (query.find("createPrayerBurden") != std::string::npos) {
            return resolveCreatePrayerBurden(variables);
        }
        if (query.find("releasePrayerBurden") != std::string::npos) {
            return resolveReleasePrayerBurden(variables);
        }
        if (query.find("createComment") != std::string::npos) {
            return resolveCreateComment(variables);
        }
        if (query.find("deleteComment") != std::string::npos) {
            return resolveDeleteComment(variables);
        }

        throw std::runtime_error("Unknown mutation");
    }

private:
    std::shared_ptr<DatabasePool> m_dbPool;
    std::shared_ptr<JWTService> m_jwt;

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

    static bool hasVar(const oatpp::Any& variables, const std::string& key) {
        if (!variables) return false;
        auto fields = variables.retrieve<oatpp::Fields<oatpp::Any>>();
        for (auto& pair : *fields) {
            if (pair.first == key && pair.second) return true;
        }
        return false;
    }

    static std::string extractVarOrNull(const oatpp::Any& variables, const std::string& key) {
        if (!hasVar(variables, key)) return "";
        return extractVar(variables, key);
    }

    static oatpp::Fields<oatpp::Any> extractInput(const oatpp::Any& variables) {
        if (!variables) throw std::runtime_error("Missing variables");
        auto fields = variables.retrieve<oatpp::Fields<oatpp::Any>>();
        for (auto& pair : *fields) {
            if (pair.first == "input") {
                return pair.second.retrieve<oatpp::Fields<oatpp::Any>>();
            }
        }
        throw std::runtime_error("Missing 'input' in variables");
    }

    static std::string inputField(const oatpp::Fields<oatpp::Any>& input, const std::string& key) {
        for (auto& pair : *input) {
            if (pair.first == key) {
                return pair.second.retrieve<oatpp::String>()->c_str();
            }
        }
        throw std::runtime_error("Missing input field: " + key);
    }

    static std::string inputFieldOrEmpty(const oatpp::Fields<oatpp::Any>& input, const std::string& key) {
        for (auto& pair : *input) {
            if (pair.first == key && pair.second) {
                return pair.second.retrieve<oatpp::String>()->c_str();
            }
        }
        return "";
    }

    // ── Auth ────────────────────────────────────────────────

    oatpp::Any resolveRegister(const oatpp::Any& variables) {
        auto input = extractInput(variables);
        auto name     = inputField(input, "name");
        auto username = inputField(input, "username");
        auto password = inputField(input, "password");

        // Hashed here, never in the database: a pgcrypto crypt() call would
        // put the plaintext on the wire and into pg_stat_statements.
        std::string passwordHash = PasswordHasher::hash(password);

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT * FROM create_user($1, $2, $3)",
            name, username, passwordHash
        );
        txn.commit();

        auto user = UserDto::createShared();
        user->id        = result[0]["id"].c_str();
        user->name      = result[0]["name"].c_str();
        user->username  = result[0]["username"].c_str();
        user->createdAt = result[0]["created_at"].c_str();
        user->updatedAt = result[0]["updated_at"].c_str();

        auto payload = AuthPayloadDto::createShared();
        payload->token = m_jwt->issue(result[0]["id"].c_str()).c_str();
        payload->user = user;
        return payload;
    }

    oatpp::Any resolveLogin(const oatpp::Any& variables) {
        auto input = extractInput(variables);
        auto username = inputField(input, "username");
        auto password = inputField(input, "password");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT * FROM \"user\" WHERE username = $1",
            username
        );
        txn.commit();

        if (result.empty()) {
            // Spend the same time a real verify would before failing, so
            // response latency does not reveal which usernames exist.
            PasswordHasher::dummyVerify(password);
            throw std::runtime_error("Invalid username or password");
        }

        std::string storedHash = result[0]["password_hash"].c_str();

        if (!PasswordHasher::verify(storedHash, password)) {
            // Identical message to the branch above — never distinguish
            // "no such user" from "wrong password" to the caller.
            throw std::runtime_error("Invalid username or password");
        }

        // The plaintext is only in hand during login, so this is the one
        // chance to upgrade a hash stored under weaker cost parameters.
        if (PasswordHasher::needsRehash(storedHash)) {
            pqxx::work rehashTxn(*conn);
            rehashTxn.exec_params(
                "UPDATE \"user\" SET password_hash = $1 WHERE id = $2",
                PasswordHasher::hash(password), result[0]["id"].c_str()
            );
            rehashTxn.commit();
        }

        auto user = UserDto::createShared();
        user->id        = result[0]["id"].c_str();
        user->name      = result[0]["name"].c_str();
        user->username  = result[0]["username"].c_str();
        user->createdAt = result[0]["created_at"].c_str();
        user->updatedAt = result[0]["updated_at"].c_str();

        auto payload = AuthPayloadDto::createShared();
        payload->token = m_jwt->issue(result[0]["id"].c_str()).c_str();
        payload->user = user;
        return payload;
    }

    // ── Person ──────────────────────────────────────────────

    oatpp::Any resolveCreatePerson(const oatpp::Any& variables) {
        auto input = extractInput(variables);
        auto name     = inputField(input, "name");
        auto statusId = inputField(input, "statusId");
        auto age      = inputFieldOrEmpty(input, "age");
        auto yearMet  = inputFieldOrEmpty(input, "yearMet");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        pqxx::result result;
        if (age.empty() && yearMet.empty()) {
            result = txn.exec_params("SELECT * FROM create_person($1, $2)", name, statusId);
        } else if (yearMet.empty()) {
            result = txn.exec_params("SELECT * FROM create_person($1, $2, $3)", name, statusId, std::stoi(age));
        } else if (age.empty()) {
            result = txn.exec_params("SELECT * FROM create_person($1, $2, NULL, $3)", name, statusId, std::stoi(yearMet));
        } else {
            result = txn.exec_params("SELECT * FROM create_person($1, $2, $3, $4)", name, statusId, std::stoi(age), std::stoi(yearMet));
        }
        txn.commit();

        auto dto = PersonDto::createShared();
        dto->id       = result[0]["id"].c_str();
        dto->name     = result[0]["name"].c_str();
        dto->isActive = result[0]["is_active"].as<bool>();
        dto->createdAt = result[0]["created_at"].c_str();
        dto->updatedAt = result[0]["updated_at"].c_str();
        if (!result[0]["age"].is_null())      dto->age = result[0]["age"].as<int>();
        if (!result[0]["year_met"].is_null()) dto->yearMet = result[0]["year_met"].as<int>();
        return dto;
    }

    oatpp::Any resolveUpdatePerson(const oatpp::Any& variables) {
        auto id    = extractVar(variables, "id");
        auto input = extractInput(variables);

        auto name     = inputFieldOrEmpty(input, "name");
        auto age      = inputFieldOrEmpty(input, "age");
        auto yearMet  = inputFieldOrEmpty(input, "yearMet");
        auto lastDate = inputFieldOrEmpty(input, "lastContactDate");
        auto isActive = inputFieldOrEmpty(input, "isActive");
        auto statusId = inputFieldOrEmpty(input, "statusId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        // Build the SP call with named parameters for partial updates
        std::string sql = "SELECT * FROM update_person(p_id := $1";
        std::vector<std::string> params = { id };
        int paramIdx = 2;

        auto addParam = [&](const std::string& val, const std::string& paramName) {
            if (!val.empty()) {
                sql += ", " + paramName + " := $" + std::to_string(paramIdx++);
                params.push_back(val);
            }
        };

        addParam(name, "p_name");
        addParam(statusId, "p_status_id");
        sql += ")";

        // For simplicity, use exec with string interpolation for named params.
        // libpqxx doesn't support dynamic param counts easily, so we use
        // the connection's exec method with a prepared-style query.
        auto result = txn.exec_params1(
            "SELECT * FROM update_person("
            "p_id := $1,"
            "p_name := CASE WHEN $2 = '' THEN NULL ELSE $2 END,"
            "p_age := CASE WHEN $3 = '' THEN NULL ELSE $3::int END,"
            "p_year_met := CASE WHEN $4 = '' THEN NULL ELSE $4::int END,"
            "p_last_contact_date := CASE WHEN $5 = '' THEN NULL ELSE $5::date END,"
            "p_is_active := CASE WHEN $6 = '' THEN NULL ELSE $6::boolean END,"
            "p_status_id := CASE WHEN $7 = '' THEN NULL ELSE $7::uuid END"
            ")",
            id, name, age, yearMet, lastDate, isActive, statusId
        );
        txn.commit();

        auto dto = PersonDto::createShared();
        dto->id        = result["id"].c_str();
        dto->name      = result["name"].c_str();
        dto->isActive  = result["is_active"].as<bool>();
        dto->createdAt = result["created_at"].c_str();
        dto->updatedAt = result["updated_at"].c_str();
        if (!result["age"].is_null())      dto->age = result["age"].as<int>();
        if (!result["year_met"].is_null()) dto->yearMet = result["year_met"].as<int>();
        return dto;
    }

    oatpp::Any resolveDeletePerson(const oatpp::Any& variables) {
        auto id = extractVar(variables, "id");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);
        txn.exec_params("SELECT * FROM delete_person($1)", id);
        txn.commit();

        return oatpp::Boolean(true);
    }

    // ── Assignment ──────────────────────────────────────────

    oatpp::Any resolveAssignPerson(const oatpp::Any& variables) {
        auto personId = extractVar(variables, "personId");
        auto userId   = extractVar(variables, "userId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);
        txn.exec_params("SELECT * FROM assign_person($1, $2)", userId, personId);
        txn.commit();

        // Return the person with updated shepherds list
        pqxx::work txn2(*conn);
        auto result = txn2.exec_params(
            "SELECT p.*, s.name AS status_name "
            "FROM person p JOIN status s ON s.id = p.status_id "
            "WHERE p.id = $1",
            personId
        );
        txn2.commit();

        auto dto = PersonDto::createShared();
        dto->id   = result[0]["id"].c_str();
        dto->name = result[0]["name"].c_str();
        return dto;
    }

    oatpp::Any resolveUnassignPerson(const oatpp::Any& variables) {
        auto personId = extractVar(variables, "personId");
        auto userId   = extractVar(variables, "userId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);
        txn.exec_params("SELECT * FROM unassign_person($1, $2)", userId, personId);
        txn.commit();

        pqxx::work txn2(*conn);
        auto result = txn2.exec_params(
            "SELECT p.*, s.name AS status_name "
            "FROM person p JOIN status s ON s.id = p.status_id "
            "WHERE p.id = $1",
            personId
        );
        txn2.commit();

        auto dto = PersonDto::createShared();
        dto->id   = result[0]["id"].c_str();
        dto->name = result[0]["name"].c_str();
        return dto;
    }

    // ── Milestones ──────────────────────────────────────────

    oatpp::Any resolveRecordMilestone(const oatpp::Any& variables) {
        auto input = extractInput(variables);
        auto personId    = inputField(input, "personId");
        auto milestoneId = inputField(input, "milestoneId");
        auto dateAchieved = inputFieldOrEmpty(input, "dateAchieved");
        auto notes        = inputFieldOrEmpty(input, "notes");

        // recordedBy comes from auth context — placeholder for now
        auto recordedBy = extractVarOrNull(variables, "userId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT * FROM record_milestone($1, $2, $3, "
            "CASE WHEN $4 = '' THEN NULL ELSE $4::date END, "
            "CASE WHEN $5 = '' THEN NULL ELSE $5 END)",
            personId, milestoneId,
            recordedBy.empty() ? nullptr : recordedBy.c_str(),
            dateAchieved, notes
        );
        txn.commit();

        auto dto = MilestonePersonDto::createShared();
        dto->id        = result[0]["id"].c_str();
        dto->createdAt = result[0]["created_at"].c_str();
        if (!result[0]["date_achieved"].is_null()) dto->dateAchieved = result[0]["date_achieved"].c_str();
        if (!result[0]["notes"].is_null())         dto->notes = result[0]["notes"].c_str();
        return dto;
    }

    oatpp::Any resolveRemoveMilestone(const oatpp::Any& variables) {
        auto personId    = extractVar(variables, "personId");
        auto milestoneId = extractVar(variables, "milestoneId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);
        txn.exec_params("SELECT * FROM remove_milestone($1, $2)", personId, milestoneId);
        txn.commit();

        return oatpp::Boolean(true);
    }

    // ── Prayer Burdens ──────────────────────────────────────

    oatpp::Any resolveCreatePrayerBurden(const oatpp::Any& variables) {
        auto input    = extractInput(variables);
        auto personId = inputField(input, "personId");
        auto content  = inputField(input, "content");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params(
            "SELECT * FROM create_prayer_burden($1, $2)",
            personId, content
        );
        txn.commit();

        auto dto = PrayerBurdenDto::createShared();
        dto->id        = result[0]["id"].c_str();
        dto->content   = result[0]["content"].c_str();
        dto->createdAt = result[0]["created_at"].c_str();
        dto->updatedAt = result[0]["updated_at"].c_str();
        return dto;
    }

    oatpp::Any resolveReleasePrayerBurden(const oatpp::Any& variables) {
        auto id = extractVar(variables, "id");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        auto result = txn.exec_params("SELECT * FROM release_prayer_burden($1)", id);
        txn.commit();

        auto dto = PrayerBurdenDto::createShared();
        dto->id           = result[0]["id"].c_str();
        dto->content      = result[0]["content"].c_str();
        dto->releasedDate = result[0]["released_date"].c_str();
        dto->createdAt    = result[0]["created_at"].c_str();
        dto->updatedAt    = result[0]["updated_at"].c_str();
        return dto;
    }

    // ── Comments ────────────────────────────────────────────

    oatpp::Any resolveCreateComment(const oatpp::Any& variables) {
        auto input          = extractInput(variables);
        auto personId       = inputField(input, "personId");
        auto content        = inputField(input, "content");
        auto prayerBurdenId = inputFieldOrEmpty(input, "prayerBurdenId");

        // userId comes from auth context — placeholder for now
        auto userId = extractVar(variables, "userId");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);

        pqxx::result result;
        if (prayerBurdenId.empty()) {
            result = txn.exec_params(
                "SELECT * FROM create_comment($1, $2, $3)",
                userId, personId, content
            );
        } else {
            result = txn.exec_params(
                "SELECT * FROM create_comment($1, $2, $3, $4)",
                userId, personId, content, prayerBurdenId
            );
        }
        txn.commit();

        auto dto = CommentDto::createShared();
        dto->id        = result[0]["id"].c_str();
        dto->content   = result[0]["content"].c_str();
        dto->createdAt = result[0]["created_at"].c_str();
        dto->updatedAt = result[0]["updated_at"].c_str();
        if (!result[0]["prayer_burden_id"].is_null()) {
            dto->prayerBurdenId = result[0]["prayer_burden_id"].c_str();
        }
        return dto;
    }

    oatpp::Any resolveDeleteComment(const oatpp::Any& variables) {
        auto id = extractVar(variables, "id");

        PooledConnection conn(m_dbPool);
        pqxx::work txn(*conn);
        txn.exec_params("SELECT * FROM delete_comment($1)", id);
        txn.commit();

        return oatpp::Boolean(true);
    }
};

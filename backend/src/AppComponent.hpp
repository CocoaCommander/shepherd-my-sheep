#pragma once

#include "oatpp/web/server/HttpRouter.hpp"
#include "oatpp/parser/json/mapping/ObjectMapper.hpp"
#include "oatpp/core/macro/component.hpp"

#include "db/DatabasePool.hpp"
#include "auth/JWTService.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

class AppComponent {
public:

    OATPP_CREATE_COMPONENT(
        std::shared_ptr<oatpp::data::mapping::ObjectMapper>,
        objectMapper
    )([] {
        return oatpp::parser::json::mapping::ObjectMapper::createShared();
    }());

    OATPP_CREATE_COMPONENT(
        std::shared_ptr<oatpp::web::server::HttpRouter>,
        httpRouter
    )([] {
        return oatpp::web::server::HttpRouter::createShared();
    }());

    OATPP_CREATE_COMPONENT(
        std::shared_ptr<DatabasePool>,
        dbPool
    )([] {
        auto env = validateEnv();

        auto connStr = std::string("")
            + "host="      + env.dbHost
            + " port="     + env.dbPort
            + " dbname="   + env.dbName
            + " user="     + env.dbUser
            + " password=" + env.dbPassword;

        return std::make_shared<DatabasePool>(connStr, /*poolSize=*/4);
    }());

    OATPP_CREATE_COMPONENT(
        std::shared_ptr<JWTService>,
        jwtService
    )([] {
        auto env = validateEnv();

        return std::make_shared<JWTService>(
            env.jwtSecret,
            env.jwtIssuer,
            env.jwtAccessTtl
        );
    }());

private:

    // A JWT_SECRET shorter than the HMAC-SHA256 block gains nothing from
    // the extra key schedule and is trivially brute-forced offline.
    static constexpr size_t MIN_JWT_SECRET_BYTES = 32;

    struct EnvConfig {
        std::string dbHost;
        std::string dbPort;
        std::string dbName;
        std::string dbUser;
        std::string dbPassword;
        std::string jwtSecret;
        std::string jwtIssuer;
        int         jwtAccessTtl;
    };

    static EnvConfig validateEnv() {
        std::vector<std::string> missing;
        std::vector<std::string> invalid;

        auto dbHost     = requireEnv("POSTGRES_HOST",     missing);
        auto dbPort     = requireEnv("POSTGRES_PORT",     missing);
        auto dbName     = requireEnv("POSTGRES_DB",       missing);
        auto dbUser     = requireEnv("POSTGRES_USER",     missing);
        auto dbPassword = requireEnv("POSTGRES_PASSWORD", missing);

        auto jwtSecret    = requireEnv("JWT_SECRET",     missing);
        auto jwtIssuer    = requireEnv("JWT_ISSUER",     missing);
        auto jwtAccessTtl = requireEnv("JWT_ACCESS_TTL", missing);

        if (!jwtSecret.empty() && jwtSecret.size() < MIN_JWT_SECRET_BYTES) {
            invalid.push_back(
                "JWT_SECRET must be at least " + std::to_string(MIN_JWT_SECRET_BYTES)
                + " bytes (got " + std::to_string(jwtSecret.size()) + ")");
        }

        int ttlSeconds = 0;
        if (!jwtAccessTtl.empty()) {
            try {
                size_t consumed = 0;
                ttlSeconds = std::stoi(jwtAccessTtl, &consumed);
                if (consumed != jwtAccessTtl.size() || ttlSeconds <= 0) {
                    throw std::invalid_argument("not a positive integer");
                }
            } catch (const std::exception&) {
                invalid.push_back("JWT_ACCESS_TTL must be a positive integer (seconds)");
            }
        }

        if (!missing.empty() || !invalid.empty()) {
            if (!missing.empty()) {
                std::cerr << "[FATAL] Missing required environment variables:" << std::endl;
                for (const auto& var : missing) {
                    std::cerr << "  - " << var << std::endl;
                }
            }
            if (!invalid.empty()) {
                std::cerr << "[FATAL] Invalid environment variables:" << std::endl;
                for (const auto& problem : invalid) {
                    std::cerr << "  - " << problem << std::endl;
                }
            }
            std::cerr << std::endl;
            std::cerr << "Provided:" << std::endl;
            std::cerr << "  POSTGRES_HOST: " << (dbHost.empty()     ? "(not set)" : dbHost) << std::endl;
            std::cerr << "  POSTGRES_PORT: " << (dbPort.empty()     ? "(not set)" : dbPort) << std::endl;
            std::cerr << "  POSTGRES_DB:   " << (dbName.empty()     ? "(not set)" : dbName) << std::endl;
            std::cerr << "  POSTGRES_USER: " << (dbUser.empty()     ? "(not set)" : dbUser) << std::endl;
            std::cerr << "  POSTGRES_PASSWORD: " << (dbPassword.empty() ? "(not set)" : "(set)") << std::endl;
            std::cerr << "  JWT_SECRET:     " << (jwtSecret.empty()  ? "(not set)" : "(set)") << std::endl;
            std::cerr << "  JWT_ISSUER:     " << (jwtIssuer.empty()  ? "(not set)" : jwtIssuer) << std::endl;
            std::cerr << "  JWT_ACCESS_TTL: " << (jwtAccessTtl.empty() ? "(not set)" : jwtAccessTtl) << std::endl;
            std::exit(1);
        }

        return { dbHost, dbPort, dbName, dbUser, dbPassword,
                 jwtSecret, jwtIssuer, ttlSeconds };
    }

    static std::string requireEnv(const char* name, std::vector<std::string>& missing) {
        const char* val = std::getenv(name);
        if (!val || std::string(val).empty()) {
            missing.push_back(name);
            return "";
        }
        return val;
    }
};

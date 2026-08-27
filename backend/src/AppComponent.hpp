#pragma once

#include "oatpp/web/server/HttpRouter.hpp"
#include "oatpp/parser/json/mapping/ObjectMapper.hpp"
#include "oatpp/core/macro/component.hpp"

#include "db/DatabasePool.hpp"

#include <cstdlib>
#include <iostream>
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

private:

    struct EnvConfig {
        std::string dbHost;
        std::string dbPort;
        std::string dbName;
        std::string dbUser;
        std::string dbPassword;
    };

    static EnvConfig validateEnv() {
        std::vector<std::string> missing;

        auto dbHost     = requireEnv("POSTGRES_HOST",     missing);
        auto dbPort     = requireEnv("POSTGRES_PORT",     missing);
        auto dbName     = requireEnv("POSTGRES_DB",       missing);
        auto dbUser     = requireEnv("POSTGRES_USER",     missing);
        auto dbPassword = requireEnv("POSTGRES_PASSWORD", missing);

        if (!missing.empty()) {
            std::cerr << "[FATAL] Missing required environment variables:" << std::endl;
            for (const auto& var : missing) {
                std::cerr << "  - " << var << std::endl;
            }
            std::cerr << std::endl;
            std::cerr << "Provided:" << std::endl;
            std::cerr << "  POSTGRES_HOST: " << (dbHost.empty()     ? "(not set)" : dbHost) << std::endl;
            std::cerr << "  POSTGRES_PORT: " << (dbPort.empty()     ? "(not set)" : dbPort) << std::endl;
            std::cerr << "  POSTGRES_DB:   " << (dbName.empty()     ? "(not set)" : dbName) << std::endl;
            std::cerr << "  POSTGRES_USER: " << (dbUser.empty()     ? "(not set)" : dbUser) << std::endl;
            std::cerr << "  POSTGRES_PASSWORD: " << (dbPassword.empty() ? "(not set)" : "(set)") << std::endl;
            std::exit(1);
        }

        return { dbHost, dbPort, dbName, dbUser, dbPassword };
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

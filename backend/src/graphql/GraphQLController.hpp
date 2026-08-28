#pragma once

#include "oatpp/web/server/api/ApiController.hpp"
#include "oatpp/parser/json/mapping/ObjectMapper.hpp"
#include "oatpp/core/macro/codegen.hpp"
#include "oatpp/core/macro/component.hpp"

#include "../models/DTOs.hpp"
#include "../db/DatabasePool.hpp"
#include "resolvers/QueryResolver.hpp"
#include "resolvers/MutationResolver.hpp"

#include <string>

#include OATPP_CODEGEN_BEGIN(ApiController)

/**
 * GraphQL endpoint controller.
 *
 * Handles POST /graphql — parses the incoming GraphQL request,
 * routes to the appropriate resolver, and returns the response.
 *
 * This is a lightweight hand-rolled GraphQL executor. It parses
 * the operation name/query to determine which resolver to call.
 * For a production app you'd use a full GraphQL library, but this
 * keeps things simple and educational for learning C++.
 */
class GraphQLController : public oatpp::web::server::api::ApiController {
public:
    GraphQLController(
        const std::shared_ptr<ObjectMapper>& objectMapper,
        const std::shared_ptr<DatabasePool>& dbPool
    )
        : oatpp::web::server::api::ApiController(objectMapper)
        , m_dbPool(dbPool)
        , m_queryResolver(std::make_shared<QueryResolver>(dbPool))
        , m_mutationResolver(std::make_shared<MutationResolver>(dbPool))
    {}

    ENDPOINT("POST", "/graphql", handleGraphQL,
             BODY_DTO(oatpp::Object<GraphQLRequest>, request))
    {
        auto response = GraphQLResponse::createShared();

        try {
            auto query = request->query;
            if (!query || query->empty()) {
                return createErrorResponse("Query string is required");
            }

            std::string queryStr = query->c_str();

            if (isQuery(queryStr)) {
                response->data = m_queryResolver->resolve(queryStr, request->variables);
            } else if (isMutation(queryStr)) {
                response->data = m_mutationResolver->resolve(queryStr, request->variables);
            } else {
                return createErrorResponse("Unsupported operation");
            }

        } catch (const pqxx::sql_error& e) {
            return createErrorResponse(std::string("Database error: ") + e.what());
        } catch (const std::exception& e) {
            return createErrorResponse(e.what());
        }

        return createDtoResponse(Status::CODE_200, response);
    }

    ENDPOINT("GET", "/health", healthCheck)
    {
        auto response = oatpp::Fields<oatpp::String>({
            {"status", "ok"}
        });
        return createDtoResponse(Status::CODE_200, response);
    }

private:

    std::shared_ptr<DatabasePool> m_dbPool;
    std::shared_ptr<QueryResolver> m_queryResolver;
    std::shared_ptr<MutationResolver> m_mutationResolver;

    static bool isQuery(const std::string& query) {
        return query.find("query") != std::string::npos
            || query.find("{") == 0;
    }

    static bool isMutation(const std::string& query) {
        return query.find("mutation") != std::string::npos;
    }

    std::shared_ptr<oatpp::web::protocol::http::outgoing::Response>
    createErrorResponse(const std::string& message) {
        auto response = GraphQLResponse::createShared();
        auto error = GraphQLError::createShared();
        error->message = message.c_str();

        auto errors = oatpp::Vector<oatpp::Object<GraphQLError>>::createShared();
        errors->push_back(error);
        response->errors = errors;

        return createDtoResponse(Status::CODE_200, response);
    }
};

#include OATPP_CODEGEN_END(ApiController)

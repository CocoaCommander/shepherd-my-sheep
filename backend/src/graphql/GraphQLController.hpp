#pragma once

#include "oatpp/web/server/api/ApiController.hpp"
#include "oatpp/parser/json/mapping/ObjectMapper.hpp"
#include "oatpp/core/macro/codegen.hpp"
#include "oatpp/core/macro/component.hpp"

#include "../models/DTOs.hpp"
#include "../db/DatabasePool.hpp"
#include "../auth/Authenticator.hpp"
#include "../auth/JWTService.hpp"
#include "Operation.hpp"
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
 * This is a lightweight hand-rolled GraphQL executor. It reads the
 * operation type and root field (see OperationParser), resolves that one
 * field, and returns it under its response key, as GraphQL clients
 * expect: {"data": {"myPeople": [...]}}. For a production app you'd use
 * a full GraphQL library, but this keeps things simple and educational
 * for learning C++.
 *
 * Authentication happens here rather than in an interceptor because
 * only the parsed operation says whether a token is needed. Everything
 * except the register and login mutations requires
 * "Authorization: Bearer <token>"; without a valid one the response is
 * HTTP 401 with code UNAUTHENTICATED, so clients can send the user back
 * to the login screen.
 */
class GraphQLController : public oatpp::web::server::api::ApiController {
public:
    GraphQLController(const std::shared_ptr<ObjectMapper>& objectMapper, const std::shared_ptr<DatabasePool>& dbPool,
                      const std::shared_ptr<JWTService>& jwtService)
        : oatpp::web::server::api::ApiController(objectMapper), m_dbPool(dbPool),
          m_authenticator(std::make_shared<Authenticator>(jwtService)),
          m_queryResolver(std::make_shared<QueryResolver>(dbPool)),
          m_mutationResolver(std::make_shared<MutationResolver>(dbPool, jwtService)) {}

    ENDPOINT("POST", "/graphql", handleGraphQL, REQUEST(std::shared_ptr<IncomingRequest>, httpRequest),
             BODY_DTO(oatpp::Object<GraphQLRequest>, request)) {
        auto response = GraphQLResponse::createShared();

        try {
            auto query = request->query;
            if (!query || query->empty()) {
                return createErrorResponse("Query string is required");
            }

            auto op         = OperationParser::parse(query->c_str());
            bool isMutation = op.type == ParsedOperation::Type::Mutation;

            std::string userId;
            if (!(isMutation && MutationResolver::isPublic(op.field))) {
                auto header        = httpRequest->getHeader("Authorization");
                auto authenticated = m_authenticator->authenticate(header ? header->c_str() : "");
                if (!authenticated) {
                    return createUnauthenticatedResponse();
                }
                userId = *authenticated;
            }

            Args args(request->variables);
            auto value = isMutation ? m_mutationResolver->resolve(op.field, args, userId)
                                    : m_queryResolver->resolve(op.field, args, userId);

            auto data = oatpp::Fields<oatpp::Any>::createShared();
            data->push_back({oatpp::String(op.responseKey.c_str()), value});
            response->data = data;

        } catch (const Unauthenticated&) {
            return createUnauthenticatedResponse();
        } catch (const pqxx::sql_error& e) {
            return createErrorResponse(std::string("Database error: ") + e.what());
        } catch (const std::exception& e) {
            return createErrorResponse(e.what());
        }

        return createDtoResponse(Status::CODE_200, response);
    }

    ENDPOINT("GET", "/health", healthCheck) {
        auto response = oatpp::Fields<oatpp::String>({{"status", "ok"}});
        return createDtoResponse(Status::CODE_200, response);
    }

private:

    std::shared_ptr<DatabasePool>     m_dbPool;
    std::shared_ptr<Authenticator>    m_authenticator;
    std::shared_ptr<QueryResolver>    m_queryResolver;
    std::shared_ptr<MutationResolver> m_mutationResolver;

    static oatpp::Object<GraphQLResponse> errorBody(const std::string& message, const char* code = nullptr) {
        auto response  = GraphQLResponse::createShared();
        auto error     = GraphQLError::createShared();
        error->message = message.c_str();
        if (code) {
            error->extensions = oatpp::Fields<oatpp::String>({{"code", code}});
        }

        auto errors = oatpp::Vector<oatpp::Object<GraphQLError>>::createShared();
        errors->push_back(error);
        response->errors = errors;
        return response;
    }

    std::shared_ptr<oatpp::web::protocol::http::outgoing::Response> createErrorResponse(const std::string& message) {
        return createDtoResponse(Status::CODE_200, errorBody(message));
    }

    // Same body whether the token was missing, expired or forged.
    std::shared_ptr<oatpp::web::protocol::http::outgoing::Response> createUnauthenticatedResponse() {
        auto response = createDtoResponse(Status::CODE_401, errorBody("Not authenticated", "UNAUTHENTICATED"));
        response->putHeader("WWW-Authenticate", "Bearer");
        return response;
    }
};

#include OATPP_CODEGEN_END(ApiController)

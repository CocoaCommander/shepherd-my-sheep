#pragma once

#include "oatpp/web/server/interceptor/RequestInterceptor.hpp"
#include "oatpp/web/server/interceptor/ResponseInterceptor.hpp"
#include "oatpp/web/protocol/http/outgoing/ResponseFactory.hpp"

#include <string>
#include <cstdlib>

/**
 * CORS middleware — two parts:
 *
 * 1. CorsRequestInterceptor: intercepts OPTIONS preflight requests and
 *    returns 204 with the appropriate CORS headers immediately.
 *
 * 2. CorsResponseInterceptor: adds CORS headers to every response.
 *
 * Allowed origin is read from the CORS_ORIGIN env var. If not set,
 * no Access-Control-Allow-Origin header is added (requests from
 * browsers will be blocked, which is the safe default).
 */

class CorsRequestInterceptor
    : public oatpp::web::server::interceptor::RequestInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(
        const std::shared_ptr<IncomingRequest>& request
    ) override {
        auto method = request->getStartingLine().method;

        if (method == "OPTIONS") {
            auto response = oatpp::web::protocol::http::outgoing::ResponseFactory::createResponse(
                oatpp::web::protocol::http::Status::CODE_204, ""
            );
            addCorsHeaders(response);
            return response;
        }

        return nullptr;  // continue to next interceptor / handler
    }

private:
    static void addCorsHeaders(
        const std::shared_ptr<oatpp::web::protocol::http::outgoing::Response>& response
    ) {
        auto origin = getAllowedOrigin();
        if (!origin.empty()) {
            response->putHeader("Access-Control-Allow-Origin", origin);
        }
        response->putHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->putHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response->putHeader("Access-Control-Max-Age", "86400");
    }

    static std::string getAllowedOrigin() {
        const char* val = std::getenv("CORS_ORIGIN");
        return val ? val : "";
    }
};


class CorsResponseInterceptor
    : public oatpp::web::server::interceptor::ResponseInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(
        const std::shared_ptr<IncomingRequest>& request,
        const std::shared_ptr<OutgoingResponse>& response
    ) override {
        auto origin = getAllowedOrigin();
        if (!origin.empty()) {
            response->putHeader("Access-Control-Allow-Origin", origin);
        }
        response->putHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->putHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        return response;
    }

private:
    static std::string getAllowedOrigin() {
        const char* val = std::getenv("CORS_ORIGIN");
        return val ? val : "";
    }
};

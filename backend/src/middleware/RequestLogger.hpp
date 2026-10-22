#pragma once

#include "oatpp/web/server/interceptor/RequestInterceptor.hpp"
#include "oatpp/web/server/interceptor/ResponseInterceptor.hpp"

#include "ClientAddress.hpp"
#include "../Log.hpp"
#include "../graphql/ErrorMapping.hpp"

#include <memory>
#include <string>

/**
 * Request/response logger — two parts:
 *
 * 1. RequestLoggerInterceptor: logs the incoming method, path, and client
 *    address when a request arrives, at DEBUG.
 *
 * 2. ResponseLoggerInterceptor: logs the status code when the response is
 *    sent, at a level set by the status (see levelForStatus).
 *
 * Log format:
 *   [2026-08-28 14:30:00] DEBUG --> POST /graphql (from 192.168.1.5)
 *   [2026-08-28 14:30:00] INFO  <-- 200 POST /graphql
 *
 * 401, 403 and 429 also name the client address (see ClientAddress.hpp).
 * The query string is never logged (it could carry a token), and method,
 * path and address go through forLog so a crafted request line can't forge
 * extra log lines.
 */

/** 5xx is ERROR, 4xx is WARN, anything else INFO. */
inline LogLevel levelForStatus(v_int32 status) {
    if (status >= 500) return LogLevel::Error;
    if (status >= 400) return LogLevel::Warn;
    return LogLevel::Info;
}

/** "METHOD /path", query string dropped, safe for one log line. */
inline std::string methodAndPath(const std::shared_ptr<oatpp::web::protocol::http::incoming::Request>& request) {
    auto method = request->getStartingLine().method.std_str();
    auto path   = request->getStartingLine().path.std_str();
    path        = path.substr(0, path.find('?'));
    return forLog(method, 16) + " " + forLog(path, 200);
}

class RequestLoggerInterceptor : public oatpp::web::server::interceptor::RequestInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(const std::shared_ptr<IncomingRequest>& request) override {
        if (Log::enabled(LogLevel::Debug)) {
            Log::debug("--> " + methodAndPath(request) + " (from " + forLog(clientAddress(request), 64) + ")");
        }

        return nullptr;  // continue processing
    }
};

class ResponseLoggerInterceptor : public oatpp::web::server::interceptor::ResponseInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(const std::shared_ptr<IncomingRequest>&  request,
                                                const std::shared_ptr<OutgoingResponse>& response) override {
        auto status = response->getStatus().code;
        auto level  = levelForStatus(status);
        if (!Log::enabled(level)) return response;

        std::string line = "<-- " + std::to_string(status) + " " + methodAndPath(request);

        // Log extra context for auth-related and rate-limited failures
        if (status == 401 || status == 403) {
            line += " (unauthorized from " + forLog(clientAddress(request), 64) + ")";
        } else if (status == 429) {
            line += " (rate limited from " + forLog(clientAddress(request), 64) + ")";
        }

        Log::write(level, line);
        return response;
    }
};

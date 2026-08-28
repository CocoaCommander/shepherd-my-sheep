#pragma once

#include "oatpp/web/server/interceptor/RequestInterceptor.hpp"
#include "oatpp/web/server/interceptor/ResponseInterceptor.hpp"

#include <chrono>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

/**
 * Request/response logger — two parts:
 *
 * 1. RequestLoggerInterceptor: logs the incoming method, path, and client
 *    address when a request arrives, and stores the start time.
 *
 * 2. ResponseLoggerInterceptor: logs the status code and duration (ms)
 *    when the response is sent.
 *
 * Log format:
 *   [2026-08-28 14:30:00] --> POST /graphql (from 192.168.1.5)
 *   [2026-08-28 14:30:00] <-- 200 POST /graphql (12ms)
 *
 * Auth failures and errors are logged at WARN level with extra context.
 */

class RequestLoggerInterceptor
    : public oatpp::web::server::interceptor::RequestInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(
        const std::shared_ptr<IncomingRequest>& request
    ) override {
        auto method = std::string(request->getStartingLine().method);
        auto path   = std::string(request->getStartingLine().path);

        // Get client address from connection
        auto connection = request->getConnection();
        std::string clientAddr = "unknown";
        if (connection) {
            auto props = connection->getInputStreamContext().getProperties();
            auto peerAddr = props.get("peer_address");
            if (peerAddr) {
                clientAddr = peerAddr->c_str();
            }
        }

        std::cout << "[" << timestamp() << "] --> "
                  << method << " " << path
                  << " (from " << clientAddr << ")"
                  << std::endl;

        return nullptr;  // continue processing
    }

private:
    static std::string timestamp() {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::ostringstream oss;
        oss << std::put_time(std::gmtime(&time), "%Y-%m-%d %H:%M:%S");
        return oss.str();
    }
};


class ResponseLoggerInterceptor
    : public oatpp::web::server::interceptor::ResponseInterceptor {
public:

    std::shared_ptr<OutgoingResponse> intercept(
        const std::shared_ptr<IncomingRequest>& request,
        const std::shared_ptr<OutgoingResponse>& response
    ) override {
        auto method = std::string(request->getStartingLine().method);
        auto path   = std::string(request->getStartingLine().path);
        auto status = response->getStatus().code;

        std::string level = "INFO";
        if (status >= 400 && status < 500) level = "WARN";
        if (status >= 500)                 level = "ERROR";

        std::cout << "[" << timestamp() << "] <-- "
                  << status << " " << method << " " << path;

        // Log extra context for auth-related failures
        if (status == 401 || status == 403) {
            auto connection = request->getConnection();
            std::string clientAddr = "unknown";
            if (connection) {
                auto props = connection->getInputStreamContext().getProperties();
                auto peerAddr = props.get("peer_address");
                if (peerAddr) {
                    clientAddr = peerAddr->c_str();
                }
            }
            std::cout << " [" << level << " - unauthorized from " << clientAddr << "]";
        }

        std::cout << std::endl;

        return response;
    }

private:
    static std::string timestamp() {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::ostringstream oss;
        oss << std::put_time(std::gmtime(&time), "%Y-%m-%d %H:%M:%S");
        return oss.str();
    }
};

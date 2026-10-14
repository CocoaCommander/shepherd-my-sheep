#pragma once

#include "JWTService.hpp"

#include <algorithm>
#include <cctype>
#include <memory>
#include <optional>
#include <string>

/**
 * Turns an Authorization header into the caller's user id.
 *
 * This is not an oatpp RequestInterceptor because whether a request
 * needs a token depends on the GraphQL operation inside the body
 * (login and register must work without one), and interceptors only
 * see headers. GraphQLController calls authenticate() once it has
 * parsed the operation.
 */
class Authenticator {
public:
    explicit Authenticator(std::shared_ptr<JWTService> jwt) : m_jwt(std::move(jwt)) {}

    /**
     * Returns the token from "Bearer <token>", or nullopt if the header
     * is missing or uses another scheme. The scheme is case-insensitive
     * per RFC 7235.
     */
    static std::optional<std::string> extractBearerToken(const std::string& header) {
        static const std::string scheme = "bearer";

        if (header.size() <= scheme.size()) {
            return std::nullopt;
        }

        bool schemeMatches = std::equal(scheme.begin(), scheme.end(), header.begin(), [](char a, char b) {
            return a == std::tolower(static_cast<unsigned char>(b));
        });
        if (!schemeMatches || header[scheme.size()] != ' ') {
            return std::nullopt;
        }

        auto start = header.find_first_not_of(' ', scheme.size());
        if (start == std::string::npos) {
            return std::nullopt;
        }
        auto end = header.find_last_not_of(' ');
        return header.substr(start, end - start + 1);
    }

    /**
     * The verified user id, or nullopt for a missing, malformed, expired
     * or forged token. Callers treat every failure the same way so the
     * response never says which check failed.
     */
    std::optional<std::string> authenticate(const std::string& authorizationHeader) const {
        auto token = extractBearerToken(authorizationHeader);
        if (!token) {
            return std::nullopt;
        }

        try {
            auto userId = m_jwt->verify(*token);
            if (userId.empty()) {
                return std::nullopt;
            }
            return userId;
        } catch (const std::exception&) {
            return std::nullopt;
        }
    }

private:
    std::shared_ptr<JWTService> m_jwt;
};

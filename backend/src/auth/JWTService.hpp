#pragma once

#include <jwt-cpp/jwt.h>

#include <chrono>
#include <string>

/**
 * Issues and verifies access tokens (jwt-cpp, HS256).
 *
 * HS256 is symmetric: the same secret signs and verifies. That is the
 * right choice while one service does both. Switch to RS256/ES256 only
 * when something needs to verify a token without holding the key that
 * can mint one.
 *
 * The secret, issuer, and TTL come from the environment with no
 * fallbacks — see AppComponent::validateEnv().
 */
class JWTService {
public:
    JWTService(std::string secret, std::string issuer, int accessTtlSeconds)
        : m_secret(std::move(secret))
        , m_issuer(std::move(issuer))
        , m_accessTtlSeconds(accessTtlSeconds)
    {}

    /** Signs an access token whose subject is the user's UUID. */
    std::string issue(const std::string& userId) const {
        auto now = std::chrono::system_clock::now();

        return jwt::create()
            .set_type("JWT")
            .set_issuer(m_issuer)
            .set_subject(userId)
            .set_issued_at(now)
            .set_expires_at(now + std::chrono::seconds(m_accessTtlSeconds))
            .sign(jwt::algorithm::hs256{m_secret});
    }

    /**
     * Returns the subject (user id) of a valid token.
     *
     * Throws if the signature, issuer, or expiry does not check out.
     * allow_algorithm pins HS256 so a token carrying alg:none or a
     * swapped algorithm is rejected rather than trusted.
     */
    std::string verify(const std::string& token) const {
        auto decoded = jwt::decode(token);

        jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{m_secret})
            .with_issuer(m_issuer)
            .verify(decoded);

        return decoded.get_subject();
    }

private:
    std::string m_secret;
    std::string m_issuer;
    int         m_accessTtlSeconds;
};

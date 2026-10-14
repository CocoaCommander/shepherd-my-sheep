#include "auth/JWTService.hpp"

#include <gtest/gtest.h>
#include <jwt-cpp/jwt.h>

#include <chrono>

namespace {

const std::string SECRET = "0123456789abcdef0123456789abcdef-test-only";
const std::string ISSUER = "shepherd-test";

}  // namespace

TEST(JWTService, RoundTripsSubject) {
    JWTService jwt(SECRET, ISSUER, 60);
    EXPECT_EQ(jwt.verify(jwt.issue("user-123")), "user-123");
}

TEST(JWTService, IssuedTokenCarriesIssuerAndExpiry) {
    JWTService jwt(SECRET, ISSUER, 60);
    auto       decoded = jwt::decode(jwt.issue("user-123"));
    EXPECT_EQ(decoded.get_issuer(), ISSUER);
    EXPECT_EQ(decoded.get_algorithm(), "HS256");

    auto lifetime = decoded.get_expires_at() - decoded.get_issued_at();
    EXPECT_EQ(std::chrono::duration_cast<std::chrono::seconds>(lifetime).count(), 60);
}

TEST(JWTService, RejectsExpiredToken) {
    JWTService jwt(SECRET, ISSUER, 60);
    auto       past  = std::chrono::system_clock::now() - std::chrono::hours(2);
    auto       token = jwt::create()
                     .set_type("JWT")
                     .set_issuer(ISSUER)
                     .set_subject("user-123")
                     .set_issued_at(past)
                     .set_expires_at(past + std::chrono::seconds(60))
                     .sign(jwt::algorithm::hs256{SECRET});
    EXPECT_ANY_THROW(jwt.verify(token));
}

TEST(JWTService, RejectsWrongIssuer) {
    JWTService issuer(SECRET, "someone-else", 60);
    JWTService verifier(SECRET, ISSUER, 60);
    EXPECT_ANY_THROW(verifier.verify(issuer.issue("user-123")));
}

TEST(JWTService, RejectsWrongSecret) {
    JWTService issuer("another-secret-another-secret-another", ISSUER, 60);
    JWTService verifier(SECRET, ISSUER, 60);
    EXPECT_ANY_THROW(verifier.verify(issuer.issue("user-123")));
}

// alg:none tokens must never be trusted, even with valid claims.
TEST(JWTService, RejectsUnsignedToken) {
    JWTService jwt(SECRET, ISSUER, 60);
    auto       now   = std::chrono::system_clock::now();
    auto       token = jwt::create()
                     .set_type("JWT")
                     .set_issuer(ISSUER)
                     .set_subject("user-123")
                     .set_issued_at(now)
                     .set_expires_at(now + std::chrono::seconds(60))
                     .sign(jwt::algorithm::none{});
    EXPECT_ANY_THROW(jwt.verify(token));
}

TEST(JWTService, RejectsTamperedPayload) {
    JWTService jwt(SECRET, ISSUER, 60);
    auto       token     = jwt.issue("user-123");
    auto       firstDot  = token.find('.');
    auto       secondDot = token.find('.', firstDot + 1);

    auto forgedPayload = jwt::base::trim<jwt::alphabet::base64url>(jwt::base::encode<jwt::alphabet::base64url>(
        R"({"iss":"shepherd-test","sub":"someone-else","exp":9999999999})"));

    auto forged = token.substr(0, firstDot + 1) + forgedPayload + token.substr(secondDot);
    EXPECT_ANY_THROW(jwt.verify(forged));
}

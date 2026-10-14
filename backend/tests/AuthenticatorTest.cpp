#include "auth/Authenticator.hpp"

#include <gtest/gtest.h>

namespace {

const std::string SECRET = "0123456789abcdef0123456789abcdef-test-only";
const std::string ISSUER = "shepherd-test";

Authenticator makeAuthenticator() {
    return Authenticator(std::make_shared<JWTService>(SECRET, ISSUER, 60));
}

}  // namespace

TEST(ExtractBearerToken, AcceptsBearerScheme) {
    EXPECT_EQ(Authenticator::extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
}

TEST(ExtractBearerToken, SchemeIsCaseInsensitive) {
    EXPECT_EQ(Authenticator::extractBearerToken("bearer abc"), "abc");
    EXPECT_EQ(Authenticator::extractBearerToken("BEARER abc"), "abc");
}

TEST(ExtractBearerToken, TrimsSurroundingSpaces) {
    EXPECT_EQ(Authenticator::extractBearerToken("Bearer   abc  "), "abc");
}

TEST(ExtractBearerToken, RejectsMissingOrOtherSchemes) {
    EXPECT_EQ(Authenticator::extractBearerToken(""), std::nullopt);
    EXPECT_EQ(Authenticator::extractBearerToken("Bearer"), std::nullopt);
    EXPECT_EQ(Authenticator::extractBearerToken("Bearer    "), std::nullopt);
    EXPECT_EQ(Authenticator::extractBearerToken("Basic dXNlcjpwYXNz"), std::nullopt);
    EXPECT_EQ(Authenticator::extractBearerToken("Bearerabc"), std::nullopt);
    EXPECT_EQ(Authenticator::extractBearerToken("abc.def.ghi"), std::nullopt);
}

TEST(Authenticate, ReturnsSubjectOfValidToken) {
    JWTService jwt(SECRET, ISSUER, 60);
    auto       token = jwt.issue("user-123");
    EXPECT_EQ(makeAuthenticator().authenticate("Bearer " + token), "user-123");
}

TEST(Authenticate, RejectsMissingHeader) {
    EXPECT_EQ(makeAuthenticator().authenticate(""), std::nullopt);
}

TEST(Authenticate, RejectsGarbageToken) {
    EXPECT_EQ(makeAuthenticator().authenticate("Bearer not-a-jwt"), std::nullopt);
}

TEST(Authenticate, RejectsTokenSignedWithAnotherSecret) {
    JWTService other("another-secret-another-secret-another", ISSUER, 60);
    EXPECT_EQ(makeAuthenticator().authenticate("Bearer " + other.issue("user-123")), std::nullopt);
}

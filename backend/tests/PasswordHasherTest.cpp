#include "auth/PasswordHasher.hpp"

#include <gtest/gtest.h>

TEST(PasswordHasher, VerifiesTheRightPassword) {
    auto hash = PasswordHasher::hash("correct horse battery staple");
    EXPECT_TRUE(PasswordHasher::verify(hash, "correct horse battery staple"));
}

TEST(PasswordHasher, RejectsTheWrongPassword) {
    auto hash = PasswordHasher::hash("correct horse battery staple");
    EXPECT_FALSE(PasswordHasher::verify(hash, "Tr0ub4dor&3"));
}

TEST(PasswordHasher, ProducesArgon2idWithFreshSalt) {
    auto a = PasswordHasher::hash("same password");
    auto b = PasswordHasher::hash("same password");
    EXPECT_EQ(a.rfind("$argon2id$", 0), 0u);
    EXPECT_NE(a, b);
}

TEST(PasswordHasher, MalformedStoredHashFailsClosed) {
    EXPECT_FALSE(PasswordHasher::verify("", "anything"));
    EXPECT_FALSE(PasswordHasher::verify("not-a-hash", "anything"));
}

TEST(PasswordHasher, CurrentHashDoesNotNeedRehash) {
    EXPECT_FALSE(PasswordHasher::needsRehash(PasswordHasher::hash("pw")));
}

TEST(PasswordHasher, WeakerHashNeedsRehash) {
    char weak[crypto_pwhash_STRBYTES];
    ASSERT_EQ(crypto_pwhash_str_alg(weak, "pw", 2, crypto_pwhash_OPSLIMIT_MIN, crypto_pwhash_MEMLIMIT_MIN,
                                    crypto_pwhash_ALG_ARGON2ID13),
              0);
    EXPECT_TRUE(PasswordHasher::needsRehash(weak));
    EXPECT_TRUE(PasswordHasher::needsRehash(""));
}

TEST(PasswordHasher, DummyVerifyDoesNotThrow) {
    EXPECT_NO_THROW(PasswordHasher::dummyVerify("whatever"));
}

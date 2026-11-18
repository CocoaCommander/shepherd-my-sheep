#include "graphql/resolvers/ResolverSupport.hpp"

#include <gtest/gtest.h>

#include <string>

// Name and description limits count characters, not bytes.
TEST(CharLength, EmptyIsZero) {
    EXPECT_EQ(charLength(""), 0u);
}

TEST(CharLength, AsciiCountsBytes) {
    EXPECT_EQ(charLength("baptised"), 8u);
}

TEST(CharLength, TwoByteCharacterCountsOnce) {
    EXPECT_EQ(charLength("\xC3\xA9"), 1u);  // é
    EXPECT_EQ(charLength("caf\xC3\xA9"), 4u);
}

TEST(CharLength, FourByteCharacterCountsOnce) {
    EXPECT_EQ(charLength("\xF0\x9F\x99\x8F"), 1u);  // folded hands emoji
    EXPECT_EQ(charLength(std::string("a\xF0\x9F\x99\x8F") + "b"), 3u);
}

TEST(CharLength, HundredMultiByteCharactersIsHundred) {
    std::string name;
    for (int i = 0; i < 100; ++i)
        name += "\xC3\xA9";
    EXPECT_EQ(name.size(), 200u);
    EXPECT_EQ(charLength(name), 100u);
}

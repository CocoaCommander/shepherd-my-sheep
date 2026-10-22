#include "middleware/ClientAddress.hpp"

#include <gtest/gtest.h>

#include <string>

TEST(ClientAddress, StripsIpv4MappedPrefix) {
    EXPECT_EQ(normalisePeerAddress("::ffff:192.168.1.5"), "192.168.1.5");
}

TEST(ClientAddress, LeavesPlainIpv4Unchanged) {
    EXPECT_EQ(normalisePeerAddress("192.168.1.5"), "192.168.1.5");
}

TEST(ClientAddress, LeavesIpv6Unchanged) {
    EXPECT_EQ(normalisePeerAddress("2001:db8::1"), "2001:db8::1");
    EXPECT_EQ(normalisePeerAddress("::1"), "::1");
}

TEST(ClientAddress, LeavesNonMappedFfffIpv6Unchanged) {
    // ::ffff:abcd is an IPv6 address, not an IPv4-mapped one
    EXPECT_EQ(normalisePeerAddress("::ffff:abcd"), "::ffff:abcd");
    EXPECT_EQ(normalisePeerAddress("::ffff:"), "::ffff:");
    // Other IPv6 forms with an embedded IPv4 keep their full text
    EXPECT_EQ(normalisePeerAddress("::ffff:0:1.2.3.4"), "::ffff:0:1.2.3.4");
    EXPECT_EQ(normalisePeerAddress("::1.2.3.4"), "::1.2.3.4");
}

TEST(ClientAddress, EmptyStaysEmpty) {
    EXPECT_EQ(normalisePeerAddress(""), "");
}

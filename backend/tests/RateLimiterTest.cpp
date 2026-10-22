#include "middleware/RateLimiter.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>

using namespace std::chrono_literals;

namespace {
/** A clock the test moves by hand, so nothing sleeps. */
struct FakeClock {
    std::shared_ptr<rate_limit::TimePoint> now = std::make_shared<rate_limit::TimePoint>(std::chrono::hours(1));

    rate_limit::Clock clock() const {
        return [now = now] { return *now; };
    }
    void advance(rate_limit::Duration by) const {
        *now += by;
    }
};

void allowed(TokenBucketLimiter& limiter, const std::string& key, int times) {
    for (int i = 0; i < times; ++i)
        EXPECT_FALSE(limiter.take(key)) << key << " request " << i + 1;
}

void failTimes(LoginBackoff& backoff, const std::string& username, int times) {
    for (int i = 0; i < times; ++i) {
        ASSERT_FALSE(backoff.check(username)) << username << " failure " << i + 1;
        backoff.recordFailure(username);
    }
}
}  // namespace

// ── Token bucket ────────────────────────────────────────────

TEST(TokenBucket, FullBucketAllowsCapacityThenRefusesWithWait) {
    FakeClock          time;
    TokenBucketLimiter limiter(3, 1s, time.clock());

    allowed(limiter, "a", 3);
    auto wait = limiter.take("a");
    ASSERT_TRUE(wait);
    EXPECT_EQ(*wait, 1s);
}

TEST(TokenBucket, WaitIsForTheNextToken) {
    FakeClock          time;
    TokenBucketLimiter limiter(2, 2s, time.clock());

    allowed(limiter, "a", 2);
    time.advance(500ms);
    auto wait = limiter.take("a");
    ASSERT_TRUE(wait);
    EXPECT_EQ(*wait, 1500ms);
}

TEST(TokenBucket, RefillsOverTime) {
    FakeClock          time;
    TokenBucketLimiter limiter(3, 1s, time.clock());

    allowed(limiter, "a", 3);
    time.advance(1s);
    allowed(limiter, "a", 1);
    EXPECT_TRUE(limiter.take("a"));
    time.advance(10s);  // never more than capacity
    allowed(limiter, "a", 3);
    EXPECT_TRUE(limiter.take("a"));
}

TEST(TokenBucket, WaitingTheGivenWaitIsEnough) {
    FakeClock          time;
    TokenBucketLimiter limiter(10, 6s, time.clock());  // AUTH_RATE_LIMIT_PER_MINUTE=10

    allowed(limiter, "a", 10);
    auto wait = limiter.take("a");
    ASSERT_TRUE(wait);
    time.advance(*wait);
    EXPECT_FALSE(limiter.take("a"));
}

TEST(TokenBucket, KeysAreIndependent) {
    FakeClock          time;
    TokenBucketLimiter limiter(2, 1s, time.clock());

    allowed(limiter, "a", 2);
    EXPECT_TRUE(limiter.take("a"));
    allowed(limiter, "b", 2);
}

TEST(TokenBucket, StaysUnderTheCap) {
    FakeClock          time;
    TokenBucketLimiter limiter(1, 1s, time.clock(), /*maxKeys=*/100);

    for (int i = 0; i < 1000; ++i) {
        limiter.take("key" + std::to_string(i));
        EXPECT_LE(limiter.size(), 100u);
    }
}

TEST(TokenBucket, PrunesFullBucketsBeforeOnesThatOweAWait) {
    FakeClock          time;
    TokenBucketLimiter limiter(2, 1s, time.clock(), /*maxKeys=*/10);

    allowed(limiter, "drained", 2);
    time.advance(1ms);
    for (int i = 0; i < 9; ++i)
        limiter.take("full" + std::to_string(i));  // these refill first
    time.advance(5s);                              // the "full" ones are full again; "drained" is too
    allowed(limiter, "drained", 2);                // and is drained again, now the newest
    limiter.take("new");                           // at the cap: the full ones go, "drained" stays
    EXPECT_LE(limiter.size(), 10u);
    EXPECT_TRUE(limiter.take("drained")) << "a key that owes a wait must not be pruned first";
}

// ── Login backoff ───────────────────────────────────────────

TEST(LoginBackoff, FiveFailuresAreFreeThenItWaitsOneSecond) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 5);
    auto wait = backoff.check("alice");
    ASSERT_TRUE(wait);
    EXPECT_EQ(*wait, 1s);
}

TEST(LoginBackoff, WaitDoublesUpToTheCap) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 5);
    rate_limit::Duration expected = 1s;
    for (int i = 0; i < 10; ++i) {  // 1 s, 2 s, ... 512 s
        auto wait = backoff.check("alice");
        ASSERT_TRUE(wait);
        EXPECT_EQ(*wait, expected) << "after " << 5 + i << " failures";
        time.advance(*wait);
        ASSERT_FALSE(backoff.check("alice"));
        backoff.recordFailure("alice");
        expected *= 2;
    }
    auto wait = backoff.check("alice");
    ASSERT_TRUE(wait);
    EXPECT_EQ(*wait, 15min);  // not 1024 s
}

TEST(LoginBackoff, BlockedUntilTheWaitIsOver) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 5);
    time.advance(999ms);
    EXPECT_TRUE(backoff.check("alice"));
    time.advance(1ms);
    EXPECT_FALSE(backoff.check("alice"));
}

TEST(LoginBackoff, SuccessResets) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 4);
    backoff.recordSuccess("alice");
    failTimes(backoff, "alice", 4);
    EXPECT_FALSE(backoff.check("alice"));
}

TEST(LoginBackoff, FifteenQuietMinutesForget) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 5);
    time.advance(15min);
    failTimes(backoff, "alice", 4);  // counted from zero again
    EXPECT_FALSE(backoff.check("alice"));
    backoff.recordFailure("alice");
    EXPECT_TRUE(backoff.check("alice"));
}

TEST(LoginBackoff, UsernamesAreIndependentAndCaseSensitive) {
    FakeClock    time;
    LoginBackoff backoff(5, 1s, 15min, 15min, time.clock());

    failTimes(backoff, "alice", 5);
    EXPECT_TRUE(backoff.check("alice"));
    EXPECT_FALSE(backoff.check("Alice"));
    EXPECT_FALSE(backoff.check("bob"));
}

TEST(LoginBackoff, StaysUnderTheCapAndKeepsWaitsOwed) {
    FakeClock    time;
    LoginBackoff backoff(1, 1min, 15min, 15min, time.clock(), /*maxKeys=*/10);

    backoff.recordFailure("old");  // blocked 1 min, then quiet: owes nothing after 15 min
    time.advance(15min);
    backoff.recordFailure("victim");  // blocked for a minute
    for (int i = 0; i < 8; ++i)
        backoff.recordFailure("noise" + std::to_string(i));
    backoff.recordFailure("one-more");  // at the cap: "old" goes, nothing else needs to
    EXPECT_LE(backoff.size(), 10u);
    EXPECT_TRUE(backoff.check("victim"));
    for (int i = 0; i < 100; ++i) {
        backoff.recordFailure("flood" + std::to_string(i));
        EXPECT_LE(backoff.size(), 10u);
    }
}

// ── Keys and RateLimits ─────────────────────────────────────

TEST(AddressKey, Ipv4IsTheWholeAddress) {
    EXPECT_EQ(addressKey("192.168.1.5"), "192.168.1.5");
}

TEST(AddressKey, Ipv6IsItsSlash64) {
    EXPECT_EQ(addressKey("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
    EXPECT_EQ(addressKey("2001:db8:1:2::ffff"), "2001:db8:1:2::/64");
    EXPECT_EQ(addressKey("::1"), "::/64");
    EXPECT_EQ(addressKey("fe80::1%eth0"), "fe80::/64");
}

TEST(AddressKey, UnparsableIsUsedAsIs) {
    EXPECT_EQ(addressKey("not:an:address"), "not:an:address");
    EXPECT_EQ(addressKey("unknown"), "unknown");
}

TEST(RateLimits, AuthIsPerAddressAndSharedByLoginAndRegister) {
    FakeClock  time;
    RateLimits limits(2, time.clock());

    limits.checkAuth("10.0.0.1", "login");
    limits.checkAuth("10.0.0.1", "register");
    try {
        limits.checkAuth("10.0.0.1", "login");
        FAIL() << "expected RateLimited";
    } catch (const RateLimited& e) {
        EXPECT_STREQ(e.what(), AUTH_RATE_LIMIT_MESSAGE);
        EXPECT_EQ(retryAfterSeconds(e.wait), 30);  // 2 a minute
    }
    EXPECT_NO_THROW(limits.checkAuth("10.0.0.2", "login"));
}

TEST(RateLimits, OneIpv6Slash64SharesABucket) {
    FakeClock  time;
    RateLimits limits(1, time.clock());

    limits.checkAuth("2001:db8:1:2::1", "login");
    EXPECT_THROW(limits.checkAuth("2001:db8:1:2::99", "login"), RateLimited);
    EXPECT_NO_THROW(limits.checkAuth("2001:db8:1:3::1", "login"));
}

TEST(RateLimits, UnknownAddressSkipsThePerAddressLimit) {
    FakeClock  time;
    RateLimits limits(1, time.clock());

    for (int i = 0; i < 10; ++i)
        EXPECT_NO_THROW(limits.checkAuth("unknown", "login"));
}

TEST(RateLimits, SearchIsTwentyThenOneASecondPerUser) {
    FakeClock  time;
    RateLimits limits(10, time.clock());

    for (int i = 0; i < 20; ++i)
        limits.checkSearch("user-1");
    try {
        limits.checkSearch("user-1");
        FAIL() << "expected RateLimited";
    } catch (const RateLimited& e) {
        EXPECT_STREQ(e.what(), SEARCH_RATE_LIMIT_MESSAGE);
        EXPECT_EQ(retryAfterSeconds(e.wait), 1);
    }
    EXPECT_NO_THROW(limits.checkSearch("user-2"));
    time.advance(1s);
    EXPECT_NO_THROW(limits.checkSearch("user-1"));
}

TEST(RateLimits, LoginBackoffUsesTheAuthMessage) {
    FakeClock  time;
    RateLimits limits(10, time.clock());

    for (int i = 0; i < 5; ++i) {
        limits.checkLogin("alice");
        limits.loginFailed("alice");
    }
    try {
        limits.checkLogin("alice");
        FAIL() << "expected RateLimited";
    } catch (const RateLimited& e) {
        EXPECT_STREQ(e.what(), AUTH_RATE_LIMIT_MESSAGE);
        EXPECT_EQ(retryAfterSeconds(e.wait), 1);
    }
    time.advance(1s);
    limits.checkLogin("alice");
    limits.loginSucceeded("alice");
    for (int i = 0; i < 5; ++i) {
        limits.checkLogin("alice");
        limits.loginFailed("alice");
    }
}

TEST(RetryAfter, WholeSecondsRoundedUpAtLeastOne) {
    EXPECT_EQ(retryAfterSeconds(0s), 1);
    EXPECT_EQ(retryAfterSeconds(1ms), 1);
    EXPECT_EQ(retryAfterSeconds(1s), 1);
    EXPECT_EQ(retryAfterSeconds(1001ms), 2);
    EXPECT_EQ(retryAfterSeconds(15min), 900);
}

TEST(RateLimits, HugeUsernamesShareACappedKey) {
    FakeClock  time;
    RateLimits limits(10, time.clock());

    auto prefix = std::string(RateLimits::MAX_USERNAME_KEY, 'x');
    for (int i = 0; i < 5; ++i)
        limits.loginFailed(prefix + std::string(1000000, 'a' + i));
    EXPECT_THROW(limits.checkLogin(prefix + "anything"), RateLimited);
    EXPECT_NO_THROW(limits.checkLogin(prefix.substr(1)));
}
